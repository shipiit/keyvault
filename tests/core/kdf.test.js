import { describe, it, expect } from 'vitest';
import { DEFAULT_KDF, createKdfParams, deriveKey, exportRawKey } from '../../src/core/kdf.js';
import { toHex, utf8Encode } from '../../src/core/encoding.js';

describe('DEFAULT_KDF', () => {
  it('meets the OWASP minimum for PBKDF2-SHA256', () => {
    expect(DEFAULT_KDF.name).toBe('PBKDF2');
    expect(DEFAULT_KDF.hash).toBe('SHA-256');
    expect(DEFAULT_KDF.iterations).toBeGreaterThanOrEqual(600000);
  });

  it('is frozen so a caller cannot weaken it at runtime', () => {
    expect(Object.isFrozen(DEFAULT_KDF)).toBe(true);
  });
});

describe('createKdfParams', () => {
  it('generates a fresh 16-byte salt each time', () => {
    const a = createKdfParams();
    const b = createKdfParams();
    expect(a.salt).toHaveLength(16);
    expect(Array.from(a.salt)).not.toEqual(Array.from(b.salt));
  });

  it('carries the default iteration count', () => {
    expect(createKdfParams().iterations).toBe(DEFAULT_KDF.iterations);
  });

  it('accepts an iteration override for tests', () => {
    expect(createKdfParams({ iterations: 1000 }).iterations).toBe(1000);
  });

  it('rejects a non-positive iteration count', () => {
    expect(() => createKdfParams({ iterations: 0 })).toThrow(RangeError);
    expect(() => createKdfParams({ iterations: -1 })).toThrow(RangeError);
    expect(() => createKdfParams({ iterations: 1.5 })).toThrow(RangeError);
  });
});

describe('deriveKey', () => {
  const params = {
    name: 'PBKDF2',
    hash: 'SHA-256',
    iterations: 1000,
    salt: utf8Encode('saltsaltsaltsalt'),
  };

  it('produces a non-extractable AES-GCM-256 CryptoKey', async () => {
    const key = await deriveKey('correct horse', params);
    expect(key.type).toBe('secret');
    expect(key.algorithm.name).toBe('AES-GCM');
    expect(key.algorithm.length).toBe(256);
    expect(key.extractable).toBe(false);
  });

  it('is deterministic for the same password and salt', async () => {
    const a = await exportRawKey(await deriveKey('pw', params, { extractable: true }));
    const b = await exportRawKey(await deriveKey('pw', params, { extractable: true }));
    expect(toHex(a)).toBe(toHex(b));
  });

  it('produces different keys for different passwords', async () => {
    const a = await exportRawKey(await deriveKey('pw1', params, { extractable: true }));
    const b = await exportRawKey(await deriveKey('pw2', params, { extractable: true }));
    expect(toHex(a)).not.toBe(toHex(b));
  });

  it('produces different keys for different salts', async () => {
    const other = { ...params, salt: utf8Encode('SALTSALTSALTSALT') };
    const a = await exportRawKey(await deriveKey('pw', params, { extractable: true }));
    const b = await exportRawKey(await deriveKey('pw', other, { extractable: true }));
    expect(toHex(a)).not.toBe(toHex(b));
  });

  it('matches the published known-answer vector for PBKDF2-HMAC-SHA256', async () => {
    // PBKDF2-HMAC-SHA256("password", "salt", c=1), first 32 bytes.
    // This is what proves the derivation is really PBKDF2-SHA256 rather than
    // something that merely round-trips consistently with itself.
    const kav = { hash: 'SHA-256', iterations: 1, salt: utf8Encode('salt') };
    const raw = await exportRawKey(await deriveKey('password', kav, { extractable: true }));
    expect(toHex(raw)).toBe('120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b');
  });

  it('matches the published vector at a higher iteration count', async () => {
    // PBKDF2-HMAC-SHA256("password", "salt", c=4096), first 32 bytes.
    const kav = { hash: 'SHA-256', iterations: 4096, salt: utf8Encode('salt') };
    const raw = await exportRawKey(await deriveKey('password', kav, { extractable: true }));
    expect(toHex(raw)).toBe('c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a');
  });

  it('derives correctly from a unicode password', async () => {
    const key = await deriveKey('pässwörd 🔐', params);
    expect(key.algorithm.name).toBe('AES-GCM');
  });

  it('rejects an empty or non-string password', async () => {
    await expect(deriveKey('', params)).rejects.toThrow(RangeError);
    await expect(deriveKey(null, params)).rejects.toThrow(RangeError);
  });
});
