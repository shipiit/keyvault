import { describe, it, expect } from 'vitest';
import {
  createVaultData,
  addEntry,
  replaceEntry,
  removeEntry,
  findEntry,
  searchEntries,
  DEFAULT_SETTINGS,
} from '../../src/core/vault-data.js';
import { createEntry } from '../../src/core/entry.js';

const NOW = 1700000000000;
const make = (title, extra = {}) => createEntry({ title, ...extra }, NOW);

describe('createVaultData', () => {
  it('starts empty with default settings', () => {
    const v = createVaultData();
    expect(v.entries).toEqual([]);
    expect(v.folders).toEqual([]);
    expect(v.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('defaults auto-lock to 15 minutes', () => {
    expect(DEFAULT_SETTINGS.autoLockMinutes).toBe(15);
  });

  it('defaults the generator to a strong length with all character classes', () => {
    expect(DEFAULT_SETTINGS.generator.length).toBeGreaterThanOrEqual(16);
    expect(DEFAULT_SETTINGS.generator.uppercase).toBe(true);
    expect(DEFAULT_SETTINGS.generator.lowercase).toBe(true);
    expect(DEFAULT_SETTINGS.generator.digits).toBe(true);
    expect(DEFAULT_SETTINGS.generator.symbols).toBe(true);
  });

  it('gives each vault its own settings object, not a shared reference', () => {
    const a = createVaultData();
    const b = createVaultData();
    a.settings.autoLockMinutes = 99;
    expect(b.settings.autoLockMinutes).toBe(15);
    expect(DEFAULT_SETTINGS.autoLockMinutes).toBe(15);
  });
});

describe('addEntry', () => {
  it('appends without mutating the input', () => {
    const v = createVaultData();
    const v2 = addEntry(v, make('GitHub'));
    expect(v2.entries).toHaveLength(1);
    expect(v.entries).toHaveLength(0);
  });

  it('rejects a duplicate id', () => {
    const e = make('GitHub');
    expect(() => addEntry(addEntry(createVaultData(), e), e)).toThrow(RangeError);
  });
});

describe('replaceEntry', () => {
  it('swaps the matching entry in place', () => {
    const a = make('A');
    const b = make('B');
    const v = addEntry(addEntry(createVaultData(), a), b);
    const v2 = replaceEntry(v, { ...a, title: 'A2' });
    expect(v2.entries.map((e) => e.title)).toEqual(['A2', 'B']);
  });

  it('does not mutate the input vault', () => {
    const a = make('A');
    const v = addEntry(createVaultData(), a);
    replaceEntry(v, { ...a, title: 'changed' });
    expect(v.entries[0].title).toBe('A');
  });

  it('throws when the entry is not present', () => {
    expect(() => replaceEntry(createVaultData(), make('X'))).toThrow(RangeError);
  });
});

describe('removeEntry', () => {
  it('drops the matching entry', () => {
    const a = make('A');
    const v = addEntry(createVaultData(), a);
    expect(removeEntry(v, a.id).entries).toHaveLength(0);
  });

  it('leaves other entries alone', () => {
    const a = make('A');
    const b = make('B');
    const v = addEntry(addEntry(createVaultData(), a), b);
    expect(removeEntry(v, a.id).entries.map((e) => e.title)).toEqual(['B']);
  });

  it('throws for an unknown id', () => {
    expect(() => removeEntry(createVaultData(), 'nope')).toThrow(RangeError);
  });
});

describe('findEntry', () => {
  it('returns the entry or null', () => {
    const a = make('A');
    const v = addEntry(createVaultData(), a);
    expect(findEntry(v, a.id)).toEqual(a);
    expect(findEntry(v, 'missing')).toBeNull();
  });
});

describe('searchEntries', () => {
  const vault = [
    make('GitHub', { username: 'rahul@example.com', urls: ['https://github.com'], tags: ['dev'] }),
    make('Gitlab', { username: 'other@example.com', urls: ['https://gitlab.com'] }),
    make('Bank of Example', {
      username: 'rahul',
      urls: ['https://bank.example'],
      tags: ['finance'],
    }),
  ].reduce((v, e) => addEntry(v, e), createVaultData());

  it('returns everything for an empty query', () => {
    expect(searchEntries(vault, '')).toHaveLength(3);
    expect(searchEntries(vault, '   ')).toHaveLength(3);
  });

  it('matches on title, case-insensitively', () => {
    expect(searchEntries(vault, 'github').map((e) => e.title)).toEqual(['GitHub']);
    expect(searchEntries(vault, 'GITHUB').map((e) => e.title)).toEqual(['GitHub']);
  });

  it('matches on username', () => {
    expect(searchEntries(vault, 'other@').map((e) => e.title)).toEqual(['Gitlab']);
  });

  it('matches on url', () => {
    expect(searchEntries(vault, 'bank.example').map((e) => e.title)).toEqual(['Bank of Example']);
  });

  it('matches on tag', () => {
    expect(searchEntries(vault, 'finance').map((e) => e.title)).toEqual(['Bank of Example']);
  });

  it('matches several entries on a shared prefix', () => {
    expect(
      searchEntries(vault, 'git')
        .map((e) => e.title)
        .sort(),
    ).toEqual(['GitHub', 'Gitlab']);
  });

  it('never searches the password field', () => {
    // Otherwise the search box becomes an oracle: type a guessed password,
    // see whether it matches. It would also surface secrets in a result list.
    const v = addEntry(createVaultData(), make('Secret', { password: 'hunter2' }));
    expect(searchEntries(v, 'hunter2')).toHaveLength(0);
  });

  it('never searches notes', () => {
    const v = addEntry(createVaultData(), make('Secret', { notes: 'recovery code 12345' }));
    expect(searchEntries(v, '12345')).toHaveLength(0);
  });

  it('never searches a TOTP secret', () => {
    const v = addEntry(
      createVaultData(),
      make('Secret', { totp: { secret: 'JBSWY3DPEHPK3PXP', issuer: 'x' } }),
    );
    expect(searchEntries(v, 'JBSWY3DP')).toHaveLength(0);
  });

  it('returns an empty array when nothing matches', () => {
    expect(searchEntries(vault, 'zzzz')).toEqual([]);
  });

  it('does not return the internal array by reference', () => {
    const result = searchEntries(vault, '');
    result.pop();
    expect(vault.entries).toHaveLength(3);
  });
});

describe('searchEntries and custom fields', () => {
  const vaultWith = (sections) => ({
    entries: [
      {
        id: '1',
        title: 'Bank',
        username: '',
        urls: [],
        tags: [],
        deletedAt: null,
        fields: { sections },
      },
    ],
  });

  it('finds an item by a custom field label', () => {
    const vault = vaultWith([
      { title: 'Recovery', fields: [{ label: 'Backup code', type: 'concealed', value: 'S3CRET' }] },
    ]);
    expect(searchEntries(vault, 'backup code')).toHaveLength(1);
    expect(searchEntries(vault, 'recovery')).toHaveLength(1);
  });

  it('finds an item by the value of an ordinary custom field', () => {
    const vault = vaultWith([
      { title: '', fields: [{ label: 'PIN', type: 'text', value: '4417' }] },
    ]);
    expect(searchEntries(vault, '4417')).toHaveLength(1);
  });

  it('never matches the value of a hidden custom field', () => {
    // The search box must not become an oracle: type a guessed secret at an
    // unlocked browser and see whether it matches.
    const vault = vaultWith([
      { title: '', fields: [{ label: 'Backup code', type: 'concealed', value: 'S3CRET' }] },
    ]);
    expect(searchEntries(vault, 'S3CRET')).toEqual([]);
    expect(searchEntries(vault, 's3cret')).toEqual([]);
  });

  it('still works for entries with no custom fields', () => {
    expect(
      searchEntries(
        {
          entries: [{ id: '1', title: 'Bank', username: '', urls: [], tags: [], deletedAt: null }],
        },
        'bank',
      ),
    ).toHaveLength(1);
  });
});
