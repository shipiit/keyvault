import { describe, it, expect, beforeEach } from 'vitest';
import { createFakeChrome } from '../helpers/fake-chrome.js';
import { createVaultService, VaultLockedError } from '../../src/background/vault-service.js';
import { createEntry } from '../../src/core/entry.js';
import { addEntry } from '../../src/core/vault-data.js';
import { InvalidPasswordError } from '../../src/core/errors.js';

const FAST = { iterations: 1000 };
const MASTER = 'correct-horse-battery-staple';

describe('createVaultService', () => {
  let chrome;
  let vault;

  beforeEach(() => {
    chrome = createFakeChrome();
    vault = createVaultService({ chrome, kdfOverrides: FAST });
  });

  describe('first run', () => {
    it('reports uninitialised and locked', async () => {
      expect(await vault.getStatus()).toEqual({ initialized: false, locked: true });
    });

    it('creates a vault and leaves it unlocked', async () => {
      await vault.create(MASTER);
      expect(await vault.getStatus()).toEqual({ initialized: true, locked: false });
    });

    it('starts with an empty entry list and default settings', async () => {
      await vault.create(MASTER);
      const data = await vault.getData();
      expect(data.entries).toEqual([]);
      expect(data.settings.autoLockMinutes).toBe(15);
    });

    it('refuses to create a second vault over an existing one', async () => {
      await vault.create(MASTER);
      await expect(vault.create('another')).rejects.toThrow(/already exists/i);
    });

    it('rejects a master password below the minimum length', async () => {
      await expect(vault.create('short')).rejects.toThrow(/at least/i);
    });
  });

  describe('lock and unlock', () => {
    beforeEach(async () => {
      await vault.create(MASTER);
    });

    it('locks on demand', async () => {
      await vault.lock();
      expect(await vault.getStatus()).toEqual({ initialized: true, locked: true });
    });

    it('unlocks with the correct password', async () => {
      await vault.lock();
      await vault.unlock(MASTER);
      expect((await vault.getStatus()).locked).toBe(false);
    });

    it('rejects the wrong password and stays locked', async () => {
      await vault.lock();
      await expect(vault.unlock('wrong')).rejects.toThrow(InvalidPasswordError);
      expect((await vault.getStatus()).locked).toBe(true);
    });

    it('refuses to unlock when no vault exists', async () => {
      const empty = createVaultService({ chrome: createFakeChrome(), kdfOverrides: FAST });
      await expect(empty.unlock(MASTER)).rejects.toThrow(/no vault/i);
    });

    it('stays unlocked across a service-worker restart', async () => {
      // The whole reason the key lives in session storage.
      chrome.__terminateServiceWorker();
      const afterRestart = createVaultService({ chrome, kdfOverrides: FAST });
      expect((await afterRestart.getStatus()).locked).toBe(false);
      expect(await afterRestart.getData()).toBeDefined();
    });

    it('locks when the browser closes', async () => {
      await chrome.__restartBrowser();
      const afterRestart = createVaultService({ chrome, kdfOverrides: FAST });
      expect((await afterRestart.getStatus()).locked).toBe(true);
    });
  });

  describe('access control while locked', () => {
    beforeEach(async () => {
      await vault.create(MASTER);
      await vault.lock();
    });

    it('refuses to read data', async () => {
      await expect(vault.getData()).rejects.toThrow(VaultLockedError);
    });

    it('refuses to mutate data', async () => {
      await expect(vault.mutate((d) => d)).rejects.toThrow(VaultLockedError);
    });
  });

  describe('mutation', () => {
    beforeEach(async () => {
      await vault.create(MASTER);
    });

    it('persists an added entry', async () => {
      await vault.mutate((data) =>
        addEntry(data, createEntry({ title: 'GitHub', password: 'pw' })),
      );
      expect((await vault.getData()).entries).toHaveLength(1);
    });

    it('survives lock and unlock', async () => {
      await vault.mutate((data) => addEntry(data, createEntry({ title: 'GitHub' })));
      await vault.lock();
      await vault.unlock(MASTER);
      expect((await vault.getData()).entries[0].title).toBe('GitHub');
    });

    it('returns the updated data to the caller', async () => {
      const result = await vault.mutate((data) => addEntry(data, createEntry({ title: 'Direct' })));
      expect(result.entries[0].title).toBe('Direct');
    });

    it('does not re-derive the key on every write', async () => {
      // Re-deriving at 600k iterations per keystroke would make the UI
      // unusable; the unlocked key is reused instead.
      let derivations = 0;
      const counting = createVaultService({
        chrome,
        kdfOverrides: FAST,
        onDerive: () => (derivations += 1),
      });
      await counting.unlock(MASTER);
      const before = derivations;
      await counting.mutate((d) => addEntry(d, createEntry({ title: 'A' })));
      await counting.mutate((d) => addEntry(d, createEntry({ title: 'B' })));
      expect(derivations).toBe(before);
    });

    it('leaves the stored blob encrypted, with no plaintext entry titles', async () => {
      await vault.mutate((data) =>
        addEntry(data, createEntry({ title: 'MyBank', password: 'hunter2' })),
      );
      const raw = JSON.stringify([...chrome.storage.local.data.values()]);
      expect(raw).not.toContain('MyBank');
      expect(raw).not.toContain('hunter2');
    });

    it('keeps a recoverable backup of the previous state', async () => {
      await vault.mutate((d) => addEntry(d, createEntry({ title: 'First' })));
      await vault.mutate((d) => addEntry(d, createEntry({ title: 'Second' })));
      expect(await vault.hasBackup()).toBe(true);
    });
  });

  describe('changeMasterPassword', () => {
    beforeEach(async () => {
      await vault.create(MASTER);
      await vault.mutate((d) => addEntry(d, createEntry({ title: 'Kept', password: 'pw' })));
    });

    it('re-encrypts the vault under the new password', async () => {
      await vault.changeMasterPassword(MASTER, 'a-brand-new-master-password');
      await vault.lock();
      await vault.unlock('a-brand-new-master-password');
      expect((await vault.getData()).entries[0].title).toBe('Kept');
    });

    it('invalidates the old password', async () => {
      await vault.changeMasterPassword(MASTER, 'a-brand-new-master-password');
      await vault.lock();
      await expect(vault.unlock(MASTER)).rejects.toThrow(InvalidPasswordError);
    });

    it('requires the current password', async () => {
      await expect(
        vault.changeMasterPassword('wrong', 'a-brand-new-master-password'),
      ).rejects.toThrow(InvalidPasswordError);
    });

    it('enforces the minimum length on the new password', async () => {
      await expect(vault.changeMasterPassword(MASTER, 'short')).rejects.toThrow(/at least/i);
    });

    it('uses a fresh salt, so the same password yields different ciphertext', async () => {
      const before = (await vault.exportDocument()).kdf.salt;
      await vault.changeMasterPassword(MASTER, 'a-brand-new-master-password');
      expect((await vault.exportDocument()).kdf.salt).not.toBe(before);
    });
  });
});
