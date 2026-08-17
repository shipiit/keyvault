import { describe, it, expect } from 'vitest';
import {
  encrypt,
  decrypt,
  encryptString,
  decryptString,
  IV_BYTES,
} from '../../src/core/cipher.js';
import { deriveKey } from '../../src/core/kdf.js';
import { utf8Encode } from '../../src/core/encoding.js';
import { DecryptionError } from '../../src/core/errors.js';

const params = { hash: 'SHA-256', iterations: 1000, salt: utf8Encode('saltsaltsaltsalt') };
const keyFor = (pw) => deriveKey(pw, params);

describe('encrypt/decrypt', () => {
  it('round-trips bytes', async () => {
    const key = await keyFor('pw');
    const plain = utf8Encode('super secret');
    const blob = await encrypt(key, plain);
    expect(Array.from(await decrypt(key, blob))).toEqual(Array.from(plain));
  });

  it('round-trips the empty payload', async () => {
    const key = await keyFor('pw');
    const blob = await encrypt(key, new Uint8Array());
    expect((await decrypt(key, blob)).length).toBe(0);
  });

  it('round-trips a large payload', async () => {
    const key = await keyFor('pw');
    const plain = new Uint8Array(200000).map((_, i) => i % 256);
    const blob = await encrypt(key, plain);
    expect(Array.from(await decrypt(key, blob))).toEqual(Array.from(plain));
  });

  it('prepends a fresh IV, so identical plaintext never yields identical output', async () => {
    // A fixed or reused IV is catastrophic in AES-GCM: it leaks the XOR of
    // the plaintexts and destroys authentication. This test is the guard.
    const key = await keyFor('pw');
    const a = await encrypt(key, utf8Encode('same'));
    const b = await encrypt(key, utf8Encode('same'));
    expect(Array.from(a.subarray(0, IV_BYTES))).not.toEqual(Array.from(b.subarray(0, IV_BYTES)));
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it('produces a blob of IV + plaintext + 16-byte GCM tag', async () => {
    const key = await keyFor('pw');
    const blob = await encrypt(key, utf8Encode('12345'));
    expect(blob.length).toBe(IV_BYTES + 5 + 16);
  });

  it('rejects the wrong key with DecryptionError', async () => {
    const blob = await encrypt(await keyFor('right'), utf8Encode('secret'));
    await expect(decrypt(await keyFor('wrong'), blob)).rejects.toThrow(DecryptionError);
  });

  it('rejects a tampered ciphertext byte', async () => {
    const key = await keyFor('pw');
    const blob = await encrypt(key, utf8Encode('secret message here'));
    blob[blob.length - 1] ^= 0x01;
    await expect(decrypt(key, blob)).rejects.toThrow(DecryptionError);
  });

  it('rejects a tampered IV', async () => {
    const key = await keyFor('pw');
    const blob = await encrypt(key, utf8Encode('secret message here'));
    blob[0] ^= 0x01;
    await expect(decrypt(key, blob)).rejects.toThrow(DecryptionError);
  });

  it('rejects a truncated blob', async () => {
    const key = await keyFor('pw');
    await expect(decrypt(key, new Uint8Array(IV_BYTES - 1))).rejects.toThrow(DecryptionError);
    await expect(decrypt(key, new Uint8Array(IV_BYTES))).rejects.toThrow(DecryptionError);
  });

  it('rejects a non-Uint8Array blob', async () => {
    const key = await keyFor('pw');
    await expect(decrypt(key, 'not bytes')).rejects.toThrow(DecryptionError);
    await expect(decrypt(key, null)).rejects.toThrow(DecryptionError);
  });

  it('does not leak the underlying crypto error message', async () => {
    const blob = await encrypt(await keyFor('right'), utf8Encode('secret'));
    await expect(decrypt(await keyFor('wrong'), blob)).rejects.toThrow(/decryption failed/i);
  });
});

describe('string helpers', () => {
  it('round-trips unicode strings', async () => {
    const key = await keyFor('pw');
    const s = 'pässwörd 🔐 密码';
    expect(await decryptString(key, await encryptString(key, s))).toBe(s);
  });

  it('round-trips the empty string', async () => {
    const key = await keyFor('pw');
    expect(await decryptString(key, await encryptString(key, ''))).toBe('');
  });
});
