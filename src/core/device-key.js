import { deriveKey, exportRawKey, importRawKey } from './kdf.js';
import { encrypt, decrypt } from './cipher.js';
import { randomBytes } from './random.js';
import { toBase64, fromBase64, utf8Encode } from './encoding.js';
import { KeyVaultError } from './errors.js';

/**
 * Unlocking with Touch ID or Windows Hello.
 *
 * ## Why this is not simply "check the fingerprint, then open the vault"
 *
 * A biometric check returns yes or no. It is not key material. If a yes were
 * treated as permission to unlock, the vault key would have to be sitting
 * somewhere already readable — which destroys the one guarantee the whole
 * design rests on: that a stolen vault file is worthless without the master
 * password.
 *
 * The WebAuthn `prf` extension is what makes this workable. A platform
 * authenticator — the Secure Enclave on a Mac, the TPM on Windows — derives
 * a stable secret from a credential plus a salt, and releases it *only*
 * after a successful biometric or device-password check. That output is real
 * key material, bound to hardware, and it never leaves the device.
 *
 * So: the vault key is wrapped under a key derived from the PRF output. The
 * wrapped copy is useless without the authenticator, and the authenticator
 * will not produce the secret without the user present.
 *
 * ## What this changes, honestly
 *
 * - The master password still works and is never replaced. Device unlock is
 *   a second door; losing the laptop must not lose the vault.
 * - The wrapped key does touch disk. It is bound to this device's
 *   authenticator, so a copied vault file cannot use it — but anyone who can
 *   pass this device's own biometric or password check can open the vault.
 *   That is the trade the user makes, and the opt-in has to say so.
 *
 * These are pure functions. The WebAuthn calls themselves need a document
 * and live in the UI layer; the wrapping lives here so it is testable in
 * plain Node like the rest of the core.
 */

/** Raised when device unlock is configured but cannot be completed. */
export class DeviceUnlockError extends KeyVaultError {}

/**
 * Fixed salt for the PRF evaluation.
 *
 * The PRF output must be reproducible across unlocks, so this cannot be
 * random per call. It is not a secret — the authenticator's own credential
 * provides the entropy — it only namespaces this use from any other.
 */
export const PRF_SALT = utf8Encode('keyvault.device-unlock.v1');

/** Iterations for stretching the PRF output. */
const WRAP_KDF_ITERATIONS = 100000;

/**
 * Derive a wrapping key from an authenticator's PRF output.
 *
 * Stretched rather than used directly. The PRF output is already 32 bytes of
 * hardware-backed entropy, so this is not adding secrecy — it is binding the
 * key to a per-vault salt, so the same authenticator on two vaults produces
 * two unrelated wrapping keys.
 *
 * @param {Uint8Array} prfOutput
 * @param {Uint8Array} salt
 * @returns {Promise<CryptoKey>}
 */
async function wrappingKeyFrom(prfOutput, salt) {
  // deriveKey takes a string password; the PRF output is bytes, so it is
  // encoded rather than reinterpreted, which would lose entropy.
  return deriveKey(toBase64(prfOutput), {
    hash: 'SHA-256',
    iterations: WRAP_KDF_ITERATIONS,
    salt,
  });
}

/**
 * Wrap the vault key so the authenticator can release it later.
 *
 * @param {CryptoKey} vaultKey an extractable AES-GCM key
 * @param {Uint8Array} prfOutput
 * @param {string} credentialId base64url, as returned by WebAuthn
 * @returns {Promise<object>} JSON-serialisable record
 */
export async function wrapVaultKey(vaultKey, prfOutput, credentialId) {
  if (vaultKey.extractable !== true) {
    throw new TypeError('vault key must be extractable to be wrapped for device unlock');
  }
  if (!(prfOutput instanceof Uint8Array) || prfOutput.length < 32) {
    throw new DeviceUnlockError('the authenticator did not return usable key material');
  }

  const salt = randomBytes(16);
  const wrappingKey = await wrappingKeyFrom(prfOutput, salt);
  const raw = await exportRawKey(vaultKey);

  return {
    version: 1,
    credentialId,
    salt: toBase64(salt),
    wrapped: toBase64(await encrypt(wrappingKey, raw)),
  };
}

/**
 * Unwrap the vault key using a fresh PRF output.
 *
 * @param {object} record produced by `wrapVaultKey`
 * @param {Uint8Array} prfOutput
 * @returns {Promise<CryptoKey>} an extractable AES-GCM key
 */
export async function unwrapVaultKey(record, prfOutput) {
  if (record === null || typeof record !== 'object' || record.wrapped === undefined) {
    throw new DeviceUnlockError('device unlock is not set up on this device');
  }
  if (!(prfOutput instanceof Uint8Array) || prfOutput.length < 32) {
    throw new DeviceUnlockError('the authenticator did not return usable key material');
  }

  const wrappingKey = await wrappingKeyFrom(prfOutput, fromBase64(record.salt));

  let raw;
  try {
    raw = await decrypt(wrappingKey, fromBase64(record.wrapped));
  } catch (cause) {
    // A different authenticator, a reset Secure Enclave, or a tampered
    // record. All of them mean the same thing to the user: use the master
    // password.
    throw new DeviceUnlockError(
      'this device could not unlock the vault. Use your master password.',
      { cause },
    );
  }

  // Extractable, because it goes straight back into session storage as raw
  // bytes — see session-key.js for why that is unavoidable under MV3.
  return importRawKey(raw, { extractable: true });
}
