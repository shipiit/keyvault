import { createVaultDocument, unlockVault } from './seal.js';
import { ParseError } from './errors.js';

/**
 * Encrypted backup files.
 *
 * The vault lives only on this device and no server holds a copy, so a
 * backup is not a convenience — it is the only thing standing between a
 * failed disk and losing every credential. This module makes producing one
 * cheap enough that there is no excuse not to.
 *
 * A backup is the same sealed document the vault itself uses, with its own
 * freshly derived key. The export passphrase is deliberately separate from
 * the master password: a backup travels — to a USB stick, another machine,
 * a cloud drive — and reusing the master password there would spread it to
 * places the threat model never covered.
 */

/** Identifies the file and its layout. Bumped only on a breaking change. */
export const BACKUP_FORMAT = 'keyvault.backup';
export const BACKUP_VERSION = 1;

/** Matches the vault's own minimum: a backup is as valuable as the vault. */
export const MIN_PASSPHRASE_LENGTH = 12;

/**
 * Produce an encrypted backup.
 *
 * @param {object} data VaultData
 * @param {string} passphrase
 * @param {{now?: number, kdfOverrides?: object}} [options]
 * @returns {Promise<object>} JSON-serialisable backup
 */
export async function createBackup(data, passphrase, options = {}) {
  if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new RangeError(`backup passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`);
  }

  const sealed = await createVaultDocument(passphrase, data, options.kdfOverrides ?? {});
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_VERSION,
    // Plaintext metadata, deliberately limited to what a person needs to
    // identify the right file without opening it. An entry count is not a
    // secret; entry names would be.
    createdAt: options.now ?? Date.now(),
    entryCount: data.entries?.length ?? 0,
    vault: sealed,
  };
}

/**
 * Open an encrypted backup.
 *
 * @param {object|string} backup the parsed file, or its raw text
 * @param {string} passphrase
 * @returns {Promise<object>} VaultData
 */
export async function readBackup(backup, passphrase) {
  const parsed = typeof backup === 'string' ? parseJson(backup) : backup;

  if (parsed === null || typeof parsed !== 'object') {
    throw new ParseError('not a KeyVault backup file');
  }
  if (parsed.format !== BACKUP_FORMAT) {
    throw new ParseError('not a KeyVault backup file');
  }
  if (parsed.formatVersion > BACKUP_VERSION) {
    // Refuse rather than guess: a newer file may hold fields this build
    // would silently drop on the next save.
    throw new ParseError(
      `this backup was made by a newer version of KeyVault (format ${parsed.formatVersion})`,
    );
  }
  if (parsed.vault === undefined) {
    throw new ParseError('backup file is missing its encrypted contents');
  }

  const { data } = await unlockVault(parsed.vault, passphrase);
  return data;
}

/**
 * Describe a backup without decrypting it.
 *
 * Lets the UI confirm the user picked the file they meant before asking for
 * a passphrase.
 *
 * @param {object|string} backup
 * @returns {{createdAt: number|null, entryCount: number|null}}
 */
export function describeBackup(backup) {
  const parsed = typeof backup === 'string' ? parseJson(backup) : backup;
  if (parsed?.format !== BACKUP_FORMAT) {
    throw new ParseError('not a KeyVault backup file');
  }
  return {
    createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : null,
    entryCount: typeof parsed.entryCount === 'number' ? parsed.entryCount : null,
  };
}

/**
 * A filename that sorts and identifies well.
 *
 * @param {number} [now]
 * @returns {string}
 */
export function backupFilename(now = Date.now()) {
  const stamp = new Date(now).toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `keyvault-backup-${stamp}.json`;
}

/** @param {string} text */
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new ParseError('that file is not valid JSON', { cause });
  }
}
