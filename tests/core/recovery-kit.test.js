import { describe, it, expect } from 'vitest';
import { webcrypto } from 'node:crypto';
import {
  vaultFingerprint,
  buildRecoveryKit,
  forbiddenFieldsIn,
} from '../../src/core/recovery-kit.js';
import { toBase64 } from '../../src/core/encoding.js';

const SALT = toBase64(new Uint8Array(16).fill(9));
const OTHER_SALT = toBase64(new Uint8Array(16).fill(11));
const NOW = 1_700_000_000_000;

describe('vaultFingerprint', () => {
  it('is stable for the same vault', async () => {
    const a = await vaultFingerprint(SALT, webcrypto.subtle);
    const b = await vaultFingerprint(SALT, webcrypto.subtle);
    expect(a).toBe(b);
  });

  it('differs between vaults, which is the whole point', async () => {
    // After a year you may hold several backup files and no idea which vault
    // each belongs to. A fingerprint that collided would be worse than none.
    expect(await vaultFingerprint(SALT, webcrypto.subtle)).not.toBe(
      await vaultFingerprint(OTHER_SALT, webcrypto.subtle),
    );
  });

  it('is short enough to read off paper and type', async () => {
    expect(await vaultFingerprint(SALT, webcrypto.subtle)).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
  });

  it('is not the salt itself', async () => {
    // Costs nothing, and avoids a printed page carrying a verbatim copy of a
    // cryptographic parameter that then has to be explained away.
    const fingerprint = await vaultFingerprint(SALT, webcrypto.subtle);
    expect(SALT.toUpperCase()).not.toContain(fingerprint.replace('-', ''));
  });
});

describe('buildRecoveryKit', () => {
  it('carries what identifies the vault and nothing more', async () => {
    const kit = await buildRecoveryKit({
      saltBase64: SALT,
      entryCount: 8,
      version: '0.1.0',
      now: NOW,
    });
    expect(Object.keys(kit).sort()).toEqual(
      ['entryCount', 'fingerprint', 'generatedAt', 'version'].sort(),
    );
    expect(kit.entryCount).toBe(8);
    expect(kit.generatedAt).toBe(NOW);
  });

  it('never contains a secret, and a test says so out loud', async () => {
    // This page gets printed. It passes through a spooler, sometimes a shared
    // printer, and ends in a drawer. Nothing on it may be worth stealing.
    const kit = await buildRecoveryKit({
      saltBase64: SALT,
      entryCount: 8,
      version: '0.1.0',
      now: NOW,
    });
    expect(forbiddenFieldsIn(kit)).toEqual([]);
    expect(JSON.stringify(kit)).not.toContain(SALT);
  });
});

describe('forbiddenFieldsIn', () => {
  it('catches a secret added carelessly upstream', async () => {
    // The guarantee is only real if something checks it. A field added to the
    // object that feeds this page must fail loudly, not print quietly.
    expect(forbiddenFieldsIn({ fingerprint: 'A1B2-C3D4', password: 'hunter2' })).toContain(
      'password',
    );
    expect(forbiddenFieldsIn({ vault: { masterPassword: 'x' } })).toContain('vault.masterPassword');
    expect(forbiddenFieldsIn({ entries: [] })).toContain('entries');
  });

  it('catches a suffixed name, not just an exact match', async () => {
    expect(forbiddenFieldsIn({ totpSecret: 'x' })).toContain('totpSecret');
    expect(forbiddenFieldsIn({ wrappedKey: 'x' })).toContain('wrappedKey');
  });

  it('passes a clean object', () => {
    expect(forbiddenFieldsIn({ fingerprint: 'A1B2-C3D4', entryCount: 8 })).toEqual([]);
  });

  it('does not trip over null or a primitive', () => {
    for (const value of [null, undefined, 'text', 42, { nested: null }]) {
      expect(() => forbiddenFieldsIn(value)).not.toThrow();
    }
  });
});
