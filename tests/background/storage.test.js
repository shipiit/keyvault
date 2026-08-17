import { describe, it, expect, beforeEach } from 'vitest';
import { createFakeChrome } from '../helpers/fake-chrome.js';
import { createVaultStorage } from '../../src/background/storage.js';

const docV1 = { version: 1, kdf: { salt: 'a' }, verifier: 'v1', data: 'd1' };
const docV2 = { version: 1, kdf: { salt: 'a' }, verifier: 'v1', data: 'd2' };
const docV3 = { version: 1, kdf: { salt: 'a' }, verifier: 'v1', data: 'd3' };

describe('createVaultStorage', () => {
  let chrome;
  let storage;

  beforeEach(() => {
    chrome = createFakeChrome();
    storage = createVaultStorage(chrome);
  });

  it('reports no vault before anything is saved', async () => {
    expect(await storage.exists()).toBe(false);
    expect(await storage.load()).toBeNull();
  });

  it('round-trips a vault document', async () => {
    await storage.save(docV1);
    expect(await storage.load()).toEqual(docV1);
    expect(await storage.exists()).toBe(true);
  });

  it('keeps the previous document as a backup on overwrite', async () => {
    await storage.save(docV1);
    await storage.save(docV2);
    expect(await storage.load()).toEqual(docV2);
    expect(await storage.loadBackup()).toEqual(docV1);
  });

  it('rotates the backup, keeping exactly one generation', async () => {
    await storage.save(docV1);
    await storage.save(docV2);
    await storage.save(docV3);
    expect(await storage.load()).toEqual(docV3);
    expect(await storage.loadBackup()).toEqual(docV2);
  });

  it('writes no backup on the very first save', async () => {
    await storage.save(docV1);
    expect(await storage.loadBackup()).toBeNull();
  });

  it('recovers the previous document when the current one is corrupt', async () => {
    // The scenario the backup exists for: a write is interrupted or the blob
    // is damaged, and the user would otherwise lose every credential.
    await storage.save(docV1);
    await storage.save(docV2);
    await chrome.storage.local.set({ 'keyvault.vault': { garbage: true } });

    expect(await storage.load()).toEqual({ garbage: true });
    expect(await storage.loadBackup()).toEqual(docV1);
    await storage.restoreFromBackup();
    expect(await storage.load()).toEqual(docV1);
  });

  it('refuses to restore when there is no backup', async () => {
    await storage.save(docV1);
    await expect(storage.restoreFromBackup()).rejects.toThrow(/no backup/i);
  });

  it('persists across a simulated service-worker restart', async () => {
    await storage.save(docV1);
    chrome.__terminateServiceWorker();
    expect(await createVaultStorage(chrome).load()).toEqual(docV1);
  });

  it('persists across a browser restart, unlike the session key', async () => {
    await storage.save(docV1);
    await chrome.__restartBrowser();
    expect(await storage.load()).toEqual(docV1);
  });

  it('never touches session storage', async () => {
    await storage.save(docV1);
    await storage.save(docV2);
    expect(chrome.storage.session.data.size).toBe(0);
  });

  it('rejects a document that is not an object', async () => {
    await expect(storage.save(null)).rejects.toThrow(TypeError);
    await expect(storage.save('nope')).rejects.toThrow(TypeError);
  });

  it('destroys the vault and its backup together', async () => {
    await storage.save(docV1);
    await storage.save(docV2);
    await storage.destroy();
    expect(await storage.load()).toBeNull();
    expect(await storage.loadBackup()).toBeNull();
    expect(await storage.exists()).toBe(false);
  });
});
