import { describe, it, expect, beforeEach } from 'vitest';
import { createFakeChrome } from '../helpers/fake-chrome.js';
import { createVaultService } from '../../src/background/vault-service.js';
import { createAutoLock } from '../../src/background/auto-lock.js';
import { createMessageRouter } from '../../src/background/messages.js';
import { createEntry, updateEntry } from '../../src/core/entry.js';
import { addEntry, replaceEntry, findEntry } from '../../src/core/vault-data.js';

const FAST = { iterations: 1000 };
const MASTER = 'correct-horse-battery-staple';
const TRUSTED = { url: 'chrome-extension://fake-extension-id/popup.html' };

/**
 * Two devices, one file between them.
 *
 * Exercised through the real message router and the real sealing, because
 * the failure this must not have — a vault that loses an entry across a
 * sync — lives in the wiring as much as in the merge.
 */
function makeDevice() {
  const chrome = createFakeChrome();
  const vault = createVaultService({ chrome, kdfOverrides: FAST });
  const autoLock = createAutoLock({ chrome, vault });
  const router = createMessageRouter({ chrome, vault, autoLock });
  const send = (type, payload) => router.handle({ type, payload }, TRUSTED);
  return { chrome, vault, send };
}

/** The file the two devices share. */
function makeFile() {
  let contents = null;
  return {
    read: () => contents,
    write: (document) => {
      contents = JSON.parse(JSON.stringify(document));
    },
  };
}

async function syncDevice(device, file, name) {
  const result = await device.send('sync/merge', {
    remoteDocument: file.read(),
    remoteName: name,
  });
  expect(result.ok, result.error?.message).toBe(true);
  file.write(result.data.document);
  return result.data;
}

async function titles(device) {
  const data = await device.vault.getData();
  return data.entries.map((entry) => entry.title).sort();
}

describe('sync between two devices', () => {
  let a;
  let b;
  let file;

  beforeEach(async () => {
    file = makeFile();
    a = makeDevice();
    await a.vault.create(MASTER);

    // The second device starts from the first one's vault, which is how a
    // real second machine begins: restore a backup, then sync.
    b = makeDevice();
    const document = await a.vault.exportDocument();
    await b.chrome.storage.local.set({ 'keyvault.vault': document });
    await b.vault.unlock(MASTER);
  });

  it('carries a new entry from one device to the other', async () => {
    await a.vault.mutate((data) => addEntry(data, createEntry({ title: 'GitHub' })));

    await syncDevice(a, file, 'A');
    await syncDevice(b, file, 'A');

    expect(await titles(b)).toContain('GitHub');
  });

  it('brings both devices to the same contents', async () => {
    await a.vault.mutate((data) => addEntry(data, createEntry({ title: 'From A' })));
    await b.vault.mutate((data) => addEntry(data, createEntry({ title: 'From B' })));

    await syncDevice(a, file, 'B');
    await syncDevice(b, file, 'A');
    await syncDevice(a, file, 'B');

    expect(await titles(a)).toEqual(['From A', 'From B']);
    expect(await titles(b)).toEqual(['From A', 'From B']);
  });

  it('keeps both versions when the same entry changed on both', async () => {
    // The rule the feature rests on: never pick a winner.
    const entry = createEntry({ title: 'Bank', password: 'original' });
    await a.vault.mutate((data) => addEntry(data, entry));
    await syncDevice(a, file, 'B');
    await syncDevice(b, file, 'A');

    await a.vault.mutate((data) =>
      replaceEntry(data, updateEntry(findEntry(data, entry.id), { password: 'from-a' })),
    );
    await b.vault.mutate((data) =>
      replaceEntry(data, updateEntry(findEntry(data, entry.id), { password: 'from-b' })),
    );

    await syncDevice(a, file, 'B');
    const result = await syncDevice(b, file, 'MacBook');

    expect(result.report.conflicts).toHaveLength(1);
    const passwords = (await b.vault.getData()).entries.map((e) => e.password).sort();
    expect(passwords).toEqual(['from-a', 'from-b']);
  });

  it('settles: a second sync with nothing new reports no change', async () => {
    // If a merge is not idempotent, two devices generate conflict copies of
    // each other's copies forever.
    await a.vault.mutate((data) => addEntry(data, createEntry({ title: 'GitHub' })));
    await syncDevice(a, file, 'B');
    await syncDevice(b, file, 'A');
    await syncDevice(a, file, 'B');

    const again = await syncDevice(b, file, 'A');
    expect(again.report.conflicts).toEqual([]);
    expect(again.summary).toBe('Already up to date');
    expect(await titles(a)).toEqual(await titles(b));
  });

  it('refuses a file belonging to a different vault', async () => {
    // Merging two unrelated vaults would produce one belonging to neither.
    const stranger = makeDevice();
    await stranger.vault.create('a-completely-different-master');
    file.write(await stranger.vault.exportDocument());

    const result = await a.send('sync/merge', { remoteDocument: file.read() });
    expect(result.ok).toBe(false);
    expect(result.error.message).toMatch(/different vault/i);
  });

  it('never writes a decrypted vault into the file', async () => {
    await a.vault.mutate((data) =>
      addEntry(data, createEntry({ title: 'Bank', password: 'S3cr3t-value' })),
    );
    await syncDevice(a, file, 'B');

    expect(JSON.stringify(file.read())).not.toContain('S3cr3t-value');
    expect(JSON.stringify(file.read())).not.toContain('Bank');
  });

  it('refuses to sync while locked', async () => {
    await a.vault.lock();
    const result = await a.send('sync/merge', { remoteDocument: null });
    expect(result.ok).toBe(false);
  });
});
