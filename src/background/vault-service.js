import {
  createVaultDocument,
  unlockVault,
  sealVaultData,
  openVaultData,
  buildVaultDocument,
} from '../core/seal.js';
import { createVaultData } from '../core/vault-data.js';
import { deriveKey, createKdfParams } from '../core/kdf.js';
import { fromBase64 } from '../core/encoding.js';
import { KeyVaultError } from '../core/errors.js';
import { createVaultStorage } from './storage.js';
import { createSessionKeyStore } from './session-key.js';

/** Raised when an operation needs an unlocked vault and the vault is locked. */
export class VaultLockedError extends KeyVaultError {}

/**
 * Minimum master password length.
 *
 * Local-only storage means there is no server-side rate limit and no account
 * recovery: an attacker with the vault file can attempt passwords entirely
 * offline, as fast as their hardware allows. The 600k-iteration KDF raises the
 * cost per guess, but only a password with real entropy makes that matter.
 */
export const MIN_MASTER_PASSWORD_LENGTH = 12;

/**
 * Orchestrates the vault: key custody, persistence, lock state, and the
 * encrypt/decrypt cycle around every read and write.
 *
 * Holds no state of its own. Everything lives in `chrome.storage`, because a
 * Manifest V3 service worker can be terminated between any two calls — an
 * instance field would be gone by the next message.
 *
 * @param {object} options
 * @param {object} options.chrome extension API namespace
 * @param {{iterations?: number}} [options.kdfOverrides] test hook for a cheap KDF
 * @param {Function} [options.onDerive] test hook, called on each key derivation
 */
export function createVaultService({ chrome, kdfOverrides = {}, onDerive = null }) {
  const storage = createVaultStorage(chrome);
  const sessionKey = createSessionKeyStore(chrome);

  /**
   * Derive a key, always extractable: it must be parked in session storage as
   * raw bytes to survive a worker restart. See `session-key.js`.
   */
  async function derive(password, params) {
    if (onDerive !== null) {
      onDerive();
    }
    return deriveKey(password, params, { extractable: true });
  }

  function assertPasswordStrength(password) {
    if (typeof password !== 'string' || password.length < MIN_MASTER_PASSWORD_LENGTH) {
      throw new RangeError(
        `master password must be at least ${MIN_MASTER_PASSWORD_LENGTH} characters`,
      );
    }
  }

  async function requireKey() {
    const key = await sessionKey.load();
    if (key === null) {
      throw new VaultLockedError('vault is locked');
    }
    return key;
  }

  return {
    /**
     * @returns {Promise<{initialized: boolean, locked: boolean}>}
     */
    async getStatus() {
      return {
        initialized: await storage.exists(),
        locked: !(await sessionKey.isUnlocked()),
      };
    },

    /**
     * Create a new vault and leave it unlocked.
     *
     * @param {string} password
     */
    async create(password) {
      if (await storage.exists()) {
        throw new Error('a vault already exists; refusing to overwrite it');
      }
      assertPasswordStrength(password);

      await sessionKey.initialize();
      const doc = await createVaultDocument(password, createVaultData(), kdfOverrides);
      await storage.save(doc);

      const kdf = {
        hash: doc.kdf.hash,
        iterations: doc.kdf.iterations,
        salt: fromBase64(doc.kdf.salt),
      };
      await sessionKey.store(await derive(password, kdf));
    },

    /**
     * @param {string} password
     */
    async unlock(password) {
      const doc = await storage.load();
      if (doc === null) {
        throw new Error('no vault to unlock');
      }
      await sessionKey.initialize();

      // unlockVault raises InvalidPasswordError for a wrong password and
      // ParseError for a damaged payload, which the caller needs to tell
      // apart: one means "try again", the other means "restore a backup".
      await unlockVault(doc, password);

      const kdf = {
        hash: doc.kdf.hash,
        iterations: doc.kdf.iterations,
        salt: fromBase64(doc.kdf.salt),
      };
      await sessionKey.store(await derive(password, kdf));
    },

    async lock() {
      await sessionKey.clear();
    },

    /**
     * @returns {Promise<object>} decrypted VaultData
     */
    async getData() {
      const key = await requireKey();
      const doc = await storage.load();
      if (doc === null) {
        throw new Error('no vault to read');
      }
      return openVaultData(key, doc.data);
    },

    /**
     * Read, transform, and persist the vault in one step.
     *
     * The key is reused rather than re-derived: at 600k iterations, deriving
     * per write would add a fifth of a second to every keystroke-level save.
     *
     * @param {(data: object) => object} transform
     * @returns {Promise<object>} the updated VaultData
     */
    async mutate(transform) {
      const key = await requireKey();
      const doc = await storage.load();
      if (doc === null) {
        throw new Error('no vault to update');
      }
      const updated = transform(await openVaultData(key, doc.data));
      await storage.save({ ...doc, data: await sealVaultData(key, updated) });
      return updated;
    },

    /**
     * Re-encrypt the whole vault under a new master password.
     *
     * A fresh salt is generated rather than reused, so the new document shares
     * no derivation parameters with the old one.
     *
     * @param {string} currentPassword
     * @param {string} newPassword
     */
    async changeMasterPassword(currentPassword, newPassword) {
      const doc = await storage.load();
      if (doc === null) {
        throw new Error('no vault to update');
      }
      assertPasswordStrength(newPassword);

      // Verifies the current password and gives us the plaintext to re-seal.
      const { data } = await unlockVault(doc, currentPassword);

      const kdf = createKdfParams(kdfOverrides);
      const newKey = await derive(newPassword, kdf);
      await storage.save(await buildVaultDocument(newKey, kdf, data));
      await sessionKey.store(newKey);
    },

    /**
     * @returns {Promise<boolean>} whether a recoverable backup exists
     */
    async hasBackup() {
      return (await storage.loadBackup()) !== null;
    },

    /**
     * Promote the backup to being the live vault, after a corrupt payload.
     */
    async restoreFromBackup() {
      await storage.restoreFromBackup();
      await sessionKey.clear();
    },

    /**
     * The raw encrypted document, for backup export. Still encrypted — this
     * exposes no secrets.
     *
     * @returns {Promise<object|null>}
     */
    async exportDocument() {
      return storage.load();
    },
  };
}
