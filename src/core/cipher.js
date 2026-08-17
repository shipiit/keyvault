import { concatBytes, utf8Encode, utf8Decode } from './encoding.js';
import { randomBytes } from './random.js';
import { DecryptionError } from './errors.js';

/** AES-GCM nonce length. 96 bits is the NIST-recommended size. */
export const IV_BYTES = 12;

/** AES-GCM authentication tag length, in bytes. */
const TAG_BYTES = 16;

/**
 * Encrypt bytes under an AES-GCM key.
 *
 * A fresh random IV is generated for every call and prepended to the
 * ciphertext. Reusing an IV under the same key breaks GCM completely — it
 * leaks the XOR of the plaintexts and forfeits authentication — so the IV is
 * deliberately not a parameter. There is no way for a caller to supply one.
 *
 * @param {CryptoKey} key
 * @param {Uint8Array} plaintext
 * @returns {Promise<Uint8Array>} iv‖ciphertext‖tag
 */
export async function encrypt(key, plaintext) {
  const iv = randomBytes(IV_BYTES);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext),
  );
  return concatBytes(iv, ciphertext);
}

/**
 * Decrypt an `iv‖ciphertext‖tag` blob.
 *
 * Every failure mode — wrong key, tampered bytes, truncated input — surfaces
 * as one DecryptionError with a generic message. The underlying WebCrypto
 * error is attached as `cause` for debugging but never becomes the message,
 * so nothing about *why* authentication failed reaches the UI or a log.
 *
 * @param {CryptoKey} key
 * @param {Uint8Array} blob
 * @returns {Promise<Uint8Array>}
 */
export async function decrypt(key, blob) {
  // A valid blob is at minimum an IV plus a tag, even for empty plaintext.
  if (!(blob instanceof Uint8Array) || blob.length < IV_BYTES + TAG_BYTES) {
    throw new DecryptionError('decryption failed: malformed ciphertext');
  }
  const iv = blob.subarray(0, IV_BYTES);
  const ciphertext = blob.subarray(IV_BYTES);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext));
  } catch (cause) {
    throw new DecryptionError('decryption failed: authentication check did not pass', { cause });
  }
}

/**
 * @param {CryptoKey} key
 * @param {string} text
 * @returns {Promise<Uint8Array>}
 */
export async function encryptString(key, text) {
  return encrypt(key, utf8Encode(text));
}

/**
 * @param {CryptoKey} key
 * @param {Uint8Array} blob
 * @returns {Promise<string>}
 */
export async function decryptString(key, blob) {
  return utf8Decode(await decrypt(key, blob));
}
