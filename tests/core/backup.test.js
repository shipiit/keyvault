import { describe, it, expect } from 'vitest';
import {
  createBackup,
  readBackup,
  describeBackup,
  backupFilename,
  BACKUP_FORMAT,
  MIN_PASSPHRASE_LENGTH,
} from '../../src/core/backup.js';
import { InvalidPasswordError, ParseError } from '../../src/core/errors.js';

const FAST = { kdfOverrides: { iterations: 1000 } };
const PASSPHRASE = 'a-long-backup-passphrase';
const NOW = 1700000000000;

const vault = {
  entries: [
    { id: 'a', title: 'GitHub', username: 'rahul', password: 'S3cr3t!' },
    { id: 'b', title: 'Bank', username: 'r.raj', password: 'hunter2' },
  ],
  folders: [],
  settings: { autoLockMinutes: 15 },
};

describe('createBackup', () => {
  it('round-trips the whole vault', async () => {
    const backup = await createBackup(vault, PASSPHRASE, FAST);
    expect(await readBackup(backup, PASSPHRASE)).toEqual(vault);
  });

  it('survives being written to and read from a file', async () => {
    const text = JSON.stringify(await createBackup(vault, PASSPHRASE, FAST));
    expect(await readBackup(text, PASSPHRASE)).toEqual(vault);
  });

  it('leaves no plaintext secret in the file', async () => {
    // The whole point: a backup travels to drives and cloud folders.
    const text = JSON.stringify(await createBackup(vault, PASSPHRASE, FAST));
    expect(text).not.toContain('S3cr3t!');
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('GitHub');
    expect(text).not.toContain(PASSPHRASE);
  });

  it('carries enough plaintext metadata to identify the file, and no more', async () => {
    const backup = await createBackup(vault, PASSPHRASE, { ...FAST, now: NOW });
    expect(backup.format).toBe(BACKUP_FORMAT);
    expect(backup.entryCount).toBe(2);
    expect(backup.createdAt).toBe(NOW);
    // A count is not a secret; names would be.
    expect(JSON.stringify(backup)).not.toContain('GitHub');
  });

  it('rejects a short passphrase', async () => {
    await expect(createBackup(vault, 'short', FAST)).rejects.toThrow(RangeError);
    await expect(createBackup(vault, 'x'.repeat(MIN_PASSPHRASE_LENGTH - 1), FAST)).rejects.toThrow(
      RangeError,
    );
  });

  it('uses a fresh salt each time, so two backups differ', async () => {
    const first = await createBackup(vault, PASSPHRASE, FAST);
    const second = await createBackup(vault, PASSPHRASE, FAST);
    expect(first.vault.kdf.salt).not.toBe(second.vault.kdf.salt);
    expect(first.vault.data).not.toBe(second.vault.data);
  });
});

describe('readBackup', () => {
  it('rejects the wrong passphrase', async () => {
    const backup = await createBackup(vault, PASSPHRASE, FAST);
    await expect(readBackup(backup, 'wrong-passphrase-here')).rejects.toThrow(InvalidPasswordError);
  });

  it('rejects a file that is not a KeyVault backup', async () => {
    await expect(readBackup('{"some":"json"}', PASSPHRASE)).rejects.toThrow(ParseError);
    await expect(readBackup('not json at all', PASSPHRASE)).rejects.toThrow(ParseError);
    await expect(readBackup(null, PASSPHRASE)).rejects.toThrow(ParseError);
  });

  it('refuses a newer format rather than guessing at it', async () => {
    // A newer file may carry fields this build would silently drop.
    const backup = await createBackup(vault, PASSPHRASE, FAST);
    backup.formatVersion = 99;
    await expect(readBackup(backup, PASSPHRASE)).rejects.toThrow(/newer version/i);
  });

  it('reports a truncated file clearly', async () => {
    const backup = await createBackup(vault, PASSPHRASE, FAST);
    delete backup.vault;
    await expect(readBackup(backup, PASSPHRASE)).rejects.toThrow(/missing its encrypted contents/);
  });
});

describe('describeBackup', () => {
  it('reads the metadata without the passphrase', async () => {
    const backup = await createBackup(vault, PASSPHRASE, { ...FAST, now: NOW });
    expect(describeBackup(backup)).toEqual({ createdAt: NOW, entryCount: 2 });
  });

  it('rejects a file that is not a backup', () => {
    expect(() => describeBackup('{"a":1}')).toThrow(ParseError);
  });
});

describe('backupFilename', () => {
  it('is sortable and identifiable', () => {
    const name = backupFilename(NOW);
    expect(name).toMatch(/^keyvault-backup-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.json$/);
  });
});
