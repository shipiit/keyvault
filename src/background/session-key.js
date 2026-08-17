import { exportRawKey, importRawKey } from '../core/kdf.js';
import { toBase64, fromBase64 } from '../core/encoding.js';

/** Session-storage key under which the unlocked vault key is parked. */
const SESSION_KEY = 'keyvault.sessionKey';

/**
 * Custody of the unlocked vault key.
 *
 * A Manifest V3 service worker is terminated after roughly 30 seconds idle,
 * so a key held in a module variable disappears mid-session and the user is
 * re-prompted for their master password constantly. `chrome.storage.session`
 * is the fix: memory-only, never written to disk, cleared when the browser
 * closes.
 *
 * The key is stored as **raw bytes**, not as a `CryptoKey`. `chrome.storage`
 * serialises values as JSON, and a `CryptoKey` is not JSON-serialisable — it
 * round-trips as `{}` with no error raised, which would fail silently and at
 * runtime. There is a test pinning that behaviour.
 *
 * The trade-off is deliberate: raw key bytes are briefly JSON in a
 * memory-only store, rather than an opaque handle. `TRUSTED_CONTEXTS` keeps
 * content scripts — and therefore any web page — from reading it, which is
 * the boundary that actually matters here.
 *
 * @param {object} chrome the extension API namespace
 */
export function createSessionKeyStore(chrome) {
  return {
    /**
     * Restrict session storage to trusted contexts.
     *
     * Must run before any key is stored. Without it, a content script running
     * in any page could read the vault key straight out of session storage.
     */
    async initialize() {
      await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    },

    /**
     * @param {CryptoKey} key an extractable AES-GCM key
     */
    async store(key) {
      if (key.extractable !== true) {
        throw new TypeError(
          'session key must be extractable: chrome.storage cannot hold a CryptoKey, ' +
            'so the key is parked as raw bytes and re-imported on each worker wake',
        );
      }
      const raw = await exportRawKey(key);
      await chrome.storage.session.set({ [SESSION_KEY]: toBase64(raw) });
    },

    /**
     * @returns {Promise<CryptoKey|null>} null when locked
     */
    async load() {
      const stored = await chrome.storage.session.get(SESSION_KEY);
      const encoded = stored[SESSION_KEY];
      if (typeof encoded !== 'string' || encoded === '') {
        return null;
      }
      try {
        return await importRawKey(fromBase64(encoded));
      } catch {
        // A malformed session value means the vault is not usable. Treating
        // that as "locked" prompts a clean re-unlock; throwing would strand
        // the user with a broken worker and no way forward.
        return null;
      }
    },

    async clear() {
      await chrome.storage.session.remove(SESSION_KEY);
    },

    /**
     * @returns {Promise<boolean>}
     */
    async isUnlocked() {
      return (await this.load()) !== null;
    },
  };
}
