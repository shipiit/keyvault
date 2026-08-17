/** Base class for every error thrown by the KeyVault core. */
export class KeyVaultError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Ciphertext failed authentication or was malformed. */
export class DecryptionError extends KeyVaultError {}

/**
 * The supplied master password did not unlock the vault.
 *
 * Deliberately distinct from DecryptionError so the UI can say "incorrect
 * password" without guessing at the cause, and so a corrupt vault is never
 * misreported as a typo.
 */
export class InvalidPasswordError extends KeyVaultError {}

/** Malformed input: bad base32, bad otpauth URI, bad vault document. */
export class ParseError extends KeyVaultError {}
