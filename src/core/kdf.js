import { randomBytes } from './random.js';
import { utf8Encode } from './encoding.js';

/**
 * Default key-derivation parameters.
 *
 * PBKDF2-SHA256 at 600k iterations is the OWASP-recommended minimum and
 * matches what Bitwarden's browser extension ships. Argon2id resists GPU
 * attack better, but requires a WASM binary, which conflicts with the
 * extension's `script-src 'self'` CSP and materially increases bundle size.
 * Revisit if that trade-off changes.
 *
 * Frozen so no caller can weaken it at runtime.
 */
export const DEFAULT_KDF = Object.freeze({
  name: 'PBKDF2',
  hash: 'SHA-256',
  iterations: 600000,
});

const SALT_BYTES = 16;
const KEY_BITS = 256;

/**
 * @param {{iterations?: number}} [overrides]
 * @returns {{name: string, hash: string, iterations: number, salt: Uint8Array}}
 */
export function createKdfParams(overrides = {}) {
  const iterations = overrides.iterations ?? DEFAULT_KDF.iterations;
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new RangeError('iterations must be an integer >= 1');
  }
  return {
    name: DEFAULT_KDF.name,
    hash: DEFAULT_KDF.hash,
    iterations,
    salt: randomBytes(SALT_BYTES),
  };
}

/**
 * Derive an AES-GCM-256 key from a master password.
 *
 * The returned key is non-extractable by default: it can encrypt and decrypt,
 * but its raw bytes cannot be read back out, even by code holding the
 * reference. `extractable: true` exists only so tests can assert derivation
 * correctness against published vectors.
 *
 * @param {string} password
 * @param {{hash: string, iterations: number, salt: Uint8Array}} params
 * @param {{extractable?: boolean}} [options]
 * @returns {Promise<CryptoKey>}
 */
export async function deriveKey(password, params, options = {}) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new RangeError('password must be a non-empty string');
  }
  const material = await crypto.subtle.importKey(
    'raw',
    utf8Encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: params.hash,
      salt: params.salt,
      iterations: params.iterations,
    },
    material,
    { name: 'AES-GCM', length: KEY_BITS },
    options.extractable === true,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Read the raw bytes of an extractable key.
 *
 * Used by tests to check derivation against published vectors, and by the
 * background layer to park the unlocked key in `chrome.storage.session`
 * across service-worker restarts — see `importRawKey` for why that is
 * necessary.
 *
 * @param {CryptoKey} key
 * @returns {Promise<Uint8Array>}
 */
export async function exportRawKey(key) {
  return new Uint8Array(await crypto.subtle.exportKey('raw', key));
}

/**
 * Rebuild an AES-GCM key from raw bytes.
 *
 * A Manifest V3 service worker is terminated after roughly 30 seconds idle,
 * taking any in-memory key with it. `chrome.storage.session` survives that,
 * but it serialises values as JSON — and a `CryptoKey` is not
 * JSON-serialisable, so storing one there yields an empty object with no
 * error raised. Raw bytes round-trip safely, so the unlocked key is parked
 * as bytes and re-imported here on each wake.
 *
 * The re-imported key is non-extractable: once it is back in WebCrypto, no
 * caller has any reason to read it out again.
 *
 * @param {Uint8Array} raw
 * @returns {Promise<CryptoKey>}
 */
export async function importRawKey(raw) {
  if (!(raw instanceof Uint8Array) || raw.length !== KEY_BITS / 8) {
    throw new RangeError(`raw key must be ${KEY_BITS / 8} bytes`);
  }
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: KEY_BITS }, false, [
    'encrypt',
    'decrypt',
  ]);
}
