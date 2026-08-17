import { describe, it, expect, beforeEach } from 'vitest';
import { createFakeChrome } from '../helpers/fake-chrome.js';
import { createSessionKeyStore } from '../../src/background/session-key.js';
import { deriveKey } from '../../src/core/kdf.js';
import { encryptString, decryptString } from '../../src/core/cipher.js';
import { utf8Encode } from '../../src/core/encoding.js';

const params = { hash: 'SHA-256', iterations: 1000, salt: utf8Encode('saltsaltsaltsalt') };
const makeKey = (pw = 'pw') => deriveKey(pw, params, { extractable: true });

describe('the constraint this module exists for', () => {
  it('confirms a CryptoKey does not survive chrome.storage serialisation', async () => {
    // This is the platform behaviour that dictates the whole design: storing
    // a CryptoKey directly appears to work and silently yields {}. If this
    // test ever fails, the platform changed and the design can be simplified.
    const chrome = createFakeChrome();
    const key = await makeKey();
    await chrome.storage.session.set({ key });
    const { key: back } = await chrome.storage.session.get('key');
    expect(back).toEqual({});
    expect(back).not.toBeInstanceOf(CryptoKey);
  });
});

describe('createSessionKeyStore', () => {
  let chrome;
  let store;

  beforeEach(() => {
    chrome = createFakeChrome();
    store = createSessionKeyStore(chrome);
  });

  it('locks session storage to trusted contexts on initialize', async () => {
    chrome.storage.session.accessLevel = null;
    await store.initialize();
    // Without this, a content script on any page could read the vault key.
    expect(chrome.storage.session.accessLevel).toBe('TRUSTED_CONTEXTS');
  });

  it('reports locked before any key is stored', async () => {
    expect(await store.isUnlocked()).toBe(false);
    expect(await store.load()).toBeNull();
  });

  it('round-trips a usable key through session storage', async () => {
    const original = await makeKey();
    await store.store(original);

    const restored = await store.load();
    expect(restored).toBeInstanceOf(CryptoKey);
    expect(restored.algorithm.name).toBe('AES-GCM');

    // The real test of "usable": ciphertext from the original key must open
    // under the restored one.
    const blob = await encryptString(original, 'secret payload');
    expect(await decryptString(restored, blob)).toBe('secret payload');
  });

  it('returns a non-extractable key, so it cannot be read back out again', async () => {
    await store.store(await makeKey());
    expect((await store.load()).extractable).toBe(false);
  });

  it('reports unlocked once a key is stored', async () => {
    await store.store(await makeKey());
    expect(await store.isUnlocked()).toBe(true);
  });

  it('survives a service-worker restart', async () => {
    const original = await makeKey();
    await store.store(original);

    // The worker dies; module state is gone. A fresh store over the same
    // chrome instance is exactly what the next wake-up sees.
    chrome.__terminateServiceWorker();
    const afterRestart = createSessionKeyStore(chrome);

    const restored = await afterRestart.load();
    expect(restored).not.toBeNull();
    const blob = await encryptString(original, 'still works');
    expect(await decryptString(restored, blob)).toBe('still works');
  });

  it('does not survive the browser closing', async () => {
    await store.store(await makeKey());
    await chrome.__restartBrowser();
    expect(await store.load()).toBeNull();
    expect(await store.isUnlocked()).toBe(false);
  });

  it('clears the key on demand', async () => {
    await store.store(await makeKey());
    await store.clear();
    expect(await store.load()).toBeNull();
    expect(await store.isUnlocked()).toBe(false);
  });

  it('leaves nothing key-shaped behind after clearing', async () => {
    await store.store(await makeKey());
    await store.clear();
    expect(JSON.stringify([...chrome.storage.session.data.entries()])).not.toMatch(
      /[A-Za-z0-9+/]{40,}/,
    );
  });

  it('never writes the key to persistent storage', async () => {
    await store.store(await makeKey());
    expect(chrome.storage.local.data.size).toBe(0);
  });

  it('rejects a non-extractable key with a clear explanation', async () => {
    const nonExtractable = await deriveKey('pw', params);
    await expect(store.store(nonExtractable)).rejects.toThrow(/extractable/i);
  });

  it('treats a corrupt session value as locked rather than crashing', async () => {
    await chrome.storage.session.set({ 'keyvault.sessionKey': 'not-valid-base64!!' });
    expect(await store.load()).toBeNull();
  });

  it('treats a wrong-length key as locked rather than crashing', async () => {
    await chrome.storage.session.set({ 'keyvault.sessionKey': 'AAAA' });
    expect(await store.load()).toBeNull();
  });
});
