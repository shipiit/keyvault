import { describe, it, expect } from 'vitest';
import { wrapVaultKey, unwrapVaultKey, DeviceUnlockError } from '../../src/core/device-key.js';
import { deriveKey } from '../../src/core/kdf.js';
import { encryptString, decryptString } from '../../src/core/cipher.js';
import { utf8Encode, toBase64 } from '../../src/core/encoding.js';

const params = { hash: 'SHA-256', iterations: 1000, salt: utf8Encode('saltsaltsaltsalt') };
const vaultKeyFor = (password = 'master') => deriveKey(password, params, { extractable: true });
const prf = () => crypto.getRandomValues(new Uint8Array(32));

describe('wrapVaultKey', () => {
  it('produces a record that opens the vault again with the same authenticator', async () => {
    const vaultKey = await vaultKeyFor();
    const output = prf();

    const record = await wrapVaultKey(vaultKey, output, 'cred-1');
    const recovered = await unwrapVaultKey(record, output);

    const sealed = await encryptString(vaultKey, 'the vault opens');
    expect(await decryptString(recovered, sealed)).toBe('the vault opens');
  });

  it('never puts the vault key in the record', async () => {
    // The record sits on disk. If the key were readable from it, the
    // authenticator would be decoration.
    const vaultKey = await vaultKeyFor();
    const raw = toBase64(new Uint8Array(await crypto.subtle.exportKey('raw', vaultKey)));

    const record = await wrapVaultKey(vaultKey, prf(), 'cred-1');
    expect(JSON.stringify(record)).not.toContain(raw);
  });

  it('survives a JSON round-trip, since it is stored as JSON', async () => {
    const vaultKey = await vaultKeyFor();
    const output = prf();
    const record = JSON.parse(JSON.stringify(await wrapVaultKey(vaultKey, output, 'cred-1')));

    expect(await unwrapVaultKey(record, output)).toBeDefined();
  });

  it('uses a fresh salt, so the same authenticator wraps two vaults differently', async () => {
    const output = prf();
    const first = await wrapVaultKey(await vaultKeyFor('one'), output, 'cred-1');
    const second = await wrapVaultKey(await vaultKeyFor('two'), output, 'cred-1');

    expect(first.salt).not.toBe(second.salt);
    // And the record for one vault must not open the other.
    await expect(unwrapVaultKey({ ...first, wrapped: second.wrapped }, output)).rejects.toThrow(
      DeviceUnlockError,
    );
  });

  it('refuses a non-extractable key rather than storing something unusable', async () => {
    const nonExtractable = await deriveKey('master', params);
    await expect(wrapVaultKey(nonExtractable, prf(), 'cred-1')).rejects.toThrow(TypeError);
  });

  it('refuses key material the authenticator did not really provide', async () => {
    const vaultKey = await vaultKeyFor();
    await expect(wrapVaultKey(vaultKey, new Uint8Array(8), 'cred-1')).rejects.toThrow(
      DeviceUnlockError,
    );
    await expect(wrapVaultKey(vaultKey, undefined, 'cred-1')).rejects.toThrow(DeviceUnlockError);
  });
});

describe('unwrapVaultKey', () => {
  it('refuses a different authenticator', async () => {
    // The whole point: the wrapped copy is bound to one device's hardware.
    const record = await wrapVaultKey(await vaultKeyFor(), prf(), 'cred-1');
    await expect(unwrapVaultKey(record, prf())).rejects.toThrow(DeviceUnlockError);
  });

  it('points the user at their master password when it cannot help', async () => {
    const record = await wrapVaultKey(await vaultKeyFor(), prf(), 'cred-1');
    await expect(unwrapVaultKey(record, prf())).rejects.toThrow(/master password/i);
  });

  it('refuses a tampered record', async () => {
    const output = prf();
    const record = await wrapVaultKey(await vaultKeyFor(), output, 'cred-1');
    record.wrapped = `${record.wrapped.slice(0, -8)}AAAAAAAA`;

    await expect(unwrapVaultKey(record, output)).rejects.toThrow(DeviceUnlockError);
  });

  it('reports plainly when device unlock was never set up', async () => {
    await expect(unwrapVaultKey(undefined, prf())).rejects.toThrow(/not set up/i);
    await expect(unwrapVaultKey({}, prf())).rejects.toThrow(/not set up/i);
  });

  it('returns a key that can be re-exported, as session storage requires', async () => {
    // MV3 cannot hold a CryptoKey across a worker restart, so the key is
    // parked as raw bytes — which needs it extractable.
    const output = prf();
    const record = await wrapVaultKey(await vaultKeyFor(), output, 'cred-1');
    const recovered = await unwrapVaultKey(record, output);

    expect(recovered.extractable).toBe(true);
  });
});
