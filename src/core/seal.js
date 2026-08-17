import { createKdfParams, deriveKey } from './kdf.js';
import { encryptString, decryptString } from './cipher.js';
import { toBase64, fromBase64 } from './encoding.js';
import { InvalidPasswordError, ParseError } from './errors.js';

/** On-disk vault document schema version. */
export const VAULT_VERSION = 1;

/**
 * Known plaintext encrypted under the derived key.
 *
 * Decrypting it proves the master password is correct without storing the
 * password or any hash of it. It also separates two failures that would
 * otherwise look identical: if the verifier opens but the payload does not,
 * the password was right and the data is damaged — which is what makes
 * recovery possible instead of leaving the user retyping a correct password.
 */
const VERIFIER_PLAINTEXT = 'keyvault.verifier.v1';

/**
 * Create a brand-new encrypted vault document.
 *
 * @param {string} password
 * @param {object} data VaultData
 * @param {{iterations?: number}} [kdfOverrides]
 * @returns {Promise<object>} JSON-serialisable vault document
 */
export async function createVaultDocument(password, data, kdfOverrides = {}) {
  const kdf = createKdfParams(kdfOverrides);
  const key = await deriveKey(password, kdf);
  return {
    version: VAULT_VERSION,
    kdf: {
      name: kdf.name,
      hash: kdf.hash,
      iterations: kdf.iterations,
      salt: toBase64(kdf.salt),
    },
    verifier: toBase64(await encryptString(key, VERIFIER_PLAINTEXT)),
    data: toBase64(await encryptString(key, JSON.stringify(data))),
  };
}

/**
 * Unlock a vault document.
 *
 * @param {object} doc
 * @param {string} password
 * @returns {Promise<{data: object, key: CryptoKey}>}
 */
export async function unlockVault(doc, password) {
  assertValidDocument(doc);

  const kdf = {
    hash: doc.kdf.hash,
    iterations: doc.kdf.iterations,
    salt: fromBase64(doc.kdf.salt),
  };
  const key = await deriveKey(password, kdf);

  // Stage 1 — the verifier answers "is this the right password?"
  try {
    const verified = await decryptString(key, fromBase64(doc.verifier));
    if (verified !== VERIFIER_PLAINTEXT) {
      throw new InvalidPasswordError('incorrect master password');
    }
  } catch (cause) {
    if (cause instanceof InvalidPasswordError) {
      throw cause;
    }
    throw new InvalidPasswordError('incorrect master password', { cause });
  }

  // Stage 2 — the password was right, so any failure here means the payload
  // itself is damaged. Reporting that distinctly is the whole point.
  let json;
  try {
    json = await decryptString(key, fromBase64(doc.data));
  } catch (cause) {
    throw new ParseError('vault data is corrupt and could not be decrypted', { cause });
  }

  let data;
  try {
    data = JSON.parse(json);
  } catch (cause) {
    throw new ParseError('vault data decrypted but is not valid JSON', { cause });
  }

  return { data, key };
}

/**
 * Encrypt vault data under an already-derived key.
 *
 * Used on every save, so the 600k-iteration derivation happens once per
 * unlock rather than once per edit.
 *
 * @param {CryptoKey} key
 * @param {object} data
 * @returns {Promise<string>} base64 blob
 */
export async function sealVaultData(key, data) {
  return toBase64(await encryptString(key, JSON.stringify(data)));
}

/**
 * @param {unknown} doc
 */
function assertValidDocument(doc) {
  if (doc === null || typeof doc !== 'object') {
    throw new ParseError('vault document must be an object');
  }
  if (doc.version !== VAULT_VERSION) {
    throw new ParseError(`unsupported vault version: ${doc.version}`);
  }
  if (doc.kdf === null || typeof doc.kdf !== 'object') {
    throw new ParseError('vault document is missing kdf parameters');
  }
  for (const field of ['salt', 'hash', 'iterations']) {
    if (doc.kdf[field] === undefined) {
      throw new ParseError(`vault document is missing kdf.${field}`);
    }
  }
  for (const field of ['verifier', 'data']) {
    if (typeof doc[field] !== 'string') {
      throw new ParseError(`vault document is missing ${field}`);
    }
  }
}
