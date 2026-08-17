import { describe, it, expect } from 'vitest';
import {
  KeyVaultError,
  DecryptionError,
  InvalidPasswordError,
  ParseError,
} from '../../src/core/errors.js';

describe('errors', () => {
  it('all extend KeyVaultError and Error', () => {
    for (const E of [DecryptionError, InvalidPasswordError, ParseError]) {
      const e = new E('boom');
      expect(e).toBeInstanceOf(Error);
      expect(e).toBeInstanceOf(KeyVaultError);
      expect(e.message).toBe('boom');
    }
  });

  it('sets name to the class name', () => {
    expect(new DecryptionError('x').name).toBe('DecryptionError');
    expect(new InvalidPasswordError('x').name).toBe('InvalidPasswordError');
    expect(new ParseError('x').name).toBe('ParseError');
  });

  it('supports a cause without leaking it into the message', () => {
    const cause = new Error('internal crypto detail');
    const e = new DecryptionError('could not decrypt', { cause });
    expect(e.cause).toBe(cause);
    expect(e.message).toBe('could not decrypt');
  });
});
