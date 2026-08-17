import { describe, it, expect } from 'vitest';
import {
  createVaultDocument,
  unlockVault,
  sealVaultData,
  VAULT_VERSION,
} from '../../src/core/seal.js';
import { InvalidPasswordError, ParseError } from '../../src/core/errors.js';
import { encryptString } from '../../src/core/cipher.js';
import { toBase64 } from '../../src/core/encoding.js';

const FAST = { iterations: 1000 }; // keep tests fast; production uses 600k
const sample = {
  entries: [{ id: 'a', title: 'Example', password: 'hunter2' }],
  folders: [],
  settings: { autoLockMinutes: 15 },
};

describe('createVaultDocument', () => {
  it('produces a serialisable document with no plaintext secrets', async () => {
    // The property an auditor checks first: nothing sensitive survives
    // serialisation in the clear.
    const doc = await createVaultDocument('master-pw', sample, FAST);
    const json = JSON.stringify(doc);
    expect(json).not.toContain('master-pw');
    expect(json).not.toContain('Example');
    expect(json).not.toContain('hunter2');
    expect(doc.version).toBe(VAULT_VERSION);
    expect(doc.kdf.name).toBe('PBKDF2');
    expect(typeof doc.kdf.salt).toBe('string');
    expect(typeof doc.verifier).toBe('string');
    expect(typeof doc.data).toBe('string');
  });

  it('survives a JSON round-trip', async () => {
    const doc = JSON.parse(JSON.stringify(await createVaultDocument('pw', sample, FAST)));
    const { data } = await unlockVault(doc, 'pw');
    expect(data).toEqual(sample);
  });

  it('uses a distinct salt per vault, so identical passwords differ', async () => {
    const a = await createVaultDocument('pw', sample, FAST);
    const b = await createVaultDocument('pw', sample, FAST);
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.data).not.toBe(b.data);
  });

  it('records the iteration count actually used', async () => {
    const doc = await createVaultDocument('pw', sample, FAST);
    expect(doc.kdf.iterations).toBe(1000);
  });
});

describe('unlockVault', () => {
  it('returns the data and a usable key', async () => {
    const doc = await createVaultDocument('pw', sample, FAST);
    const { data, key } = await unlockVault(doc, 'pw');
    expect(data).toEqual(sample);
    expect(key.algorithm.name).toBe('AES-GCM');
  });

  it('throws InvalidPasswordError for a wrong password', async () => {
    const doc = await createVaultDocument('right', sample, FAST);
    await expect(unlockVault(doc, 'wrong')).rejects.toThrow(InvalidPasswordError);
  });

  it('reports a wrong password without exposing crypto internals', async () => {
    const doc = await createVaultDocument('right', sample, FAST);
    await expect(unlockVault(doc, 'wrong')).rejects.toThrow(/incorrect master password/i);
  });

  it('throws ParseError on a corrupt data blob even with the right password', async () => {
    // Distinguishing "wrong password" from "damaged vault" is what makes
    // recovery possible instead of leaving the user retyping a correct
    // password forever.
    const doc = await createVaultDocument('pw', sample, FAST);
    doc.data = doc.data.slice(0, -8) + 'AAAAAAAA';
    await expect(unlockVault(doc, 'pw')).rejects.toThrow(ParseError);
  });

  it('rejects an unknown vault version', async () => {
    const doc = await createVaultDocument('pw', sample, FAST);
    doc.version = 99;
    await expect(unlockVault(doc, 'pw')).rejects.toThrow(ParseError);
  });

  it('rejects a document missing required fields', async () => {
    await expect(unlockVault({ version: VAULT_VERSION }, 'pw')).rejects.toThrow(ParseError);
    await expect(unlockVault({ version: VAULT_VERSION, kdf: {} }, 'pw')).rejects.toThrow(
      ParseError,
    );
  });

  it('rejects a non-object document', async () => {
    await expect(unlockVault(null, 'pw')).rejects.toThrow(ParseError);
    await expect(unlockVault('nope', 'pw')).rejects.toThrow(ParseError);
  });

  it('rejects a document whose kdf block is incomplete', async () => {
    const doc = await createVaultDocument('pw', sample, FAST);
    delete doc.kdf.salt;
    await expect(unlockVault(doc, 'pw')).rejects.toThrow(/kdf\.salt/);
  });

  it('rejects a document with a missing verifier', async () => {
    const doc = await createVaultDocument('pw', sample, FAST);
    delete doc.verifier;
    await expect(unlockVault(doc, 'pw')).rejects.toThrow(/verifier/);
  });
});

describe('unlockVault — tampering with the verifier', () => {
  it('rejects a verifier that decrypts cleanly but to the wrong plaintext', async () => {
    // An attacker who can write to storage could swap in a verifier they
    // encrypted themselves. It must not be enough that the blob decrypts —
    // the recovered plaintext has to be the expected constant.
    const doc = await createVaultDocument('pw', sample, FAST);
    const { key } = await unlockVault(doc, 'pw');
    doc.verifier = toBase64(await encryptString(key, 'attacker-chosen plaintext'));
    await expect(unlockVault(doc, 'pw')).rejects.toThrow(InvalidPasswordError);
  });

  it('rejects a payload that decrypts to valid UTF-8 but not valid JSON', async () => {
    const doc = await createVaultDocument('pw', sample, FAST);
    const { key } = await unlockVault(doc, 'pw');
    doc.data = toBase64(await encryptString(key, 'this is not json'));
    await expect(unlockVault(doc, 'pw')).rejects.toThrow(ParseError);
    await expect(unlockVault(doc, 'pw')).rejects.toThrow(/not valid JSON/i);
  });
});

describe('sealVaultData', () => {
  it('re-encrypts data under an existing key without re-deriving', async () => {
    const doc = await createVaultDocument('pw', sample, FAST);
    const { key } = await unlockVault(doc, 'pw');
    const updated = { ...sample, entries: [...sample.entries, { id: 'b', title: 'Second' }] };
    const resealed = { ...doc, data: await sealVaultData(key, updated) };
    const { data } = await unlockVault(resealed, 'pw');
    expect(data.entries).toHaveLength(2);
  });

  it('produces different ciphertext for identical data', async () => {
    const doc = await createVaultDocument('pw', sample, FAST);
    const { key } = await unlockVault(doc, 'pw');
    expect(await sealVaultData(key, sample)).not.toBe(await sealVaultData(key, sample));
  });
});
