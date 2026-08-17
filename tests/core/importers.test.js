import { describe, it, expect } from 'vitest';
import { parseCsv, parseCsvObjects, toCsv } from '../../src/core/csv.js';
import { importCsv, importBitwardenJson, importAny } from '../../src/core/importers.js';
import { ParseError } from '../../src/core/errors.js';

describe('parseCsv', () => {
  it('parses a plain file', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('keeps commas inside quoted fields', () => {
    // A password containing a comma is the single most common way a naive
    // split corrupts an import.
    expect(parseCsv('name,password\nGitHub,"a,b,c"')).toEqual([
      ['name', 'password'],
      ['GitHub', 'a,b,c'],
    ]);
  });

  it('handles doubled quotes as one literal quote', () => {
    expect(parseCsv('password\n"say ""hi"""')).toEqual([['password'], ['say "hi"']]);
  });

  it('keeps newlines inside quoted fields', () => {
    // Notes routinely span lines.
    expect(parseCsv('notes\n"line one\nline two"')).toEqual([['notes'], ['line one\nline two']]);
  });

  it('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('strips a UTF-8 BOM, which Excel writes', () => {
    // Left in place it becomes part of the first column name and every
    // header lookup silently misses.
    expect(parseCsv('﻿name,password\nA,B')[0][0]).toBe('name');
  });

  it('ignores blank lines', () => {
    expect(parseCsv('a,b\n\n1,2\n')).toHaveLength(2);
  });

  it('rejects non-string input', () => {
    expect(() => parseCsv(null)).toThrow(ParseError);
  });
});

describe('parseCsvObjects', () => {
  it('keys rows by a normalised header', () => {
    expect(parseCsvObjects('Name,Password\nGitHub,secret')).toEqual([
      { name: 'GitHub', password: 'secret' },
    ]);
  });

  it('returns nothing for a header-only file', () => {
    expect(parseCsvObjects('name,password')).toEqual([]);
  });
});

describe('toCsv', () => {
  it('quotes only what needs quoting', () => {
    expect(toCsv(['a', 'b'], [['plain', 'has,comma']])).toBe('a,b\r\nplain,"has,comma"');
  });

  it('round-trips through the parser', () => {
    const rows = [['a "quoted" value', 'line\nbreak', 'plain']];
    expect(parseCsv(toCsv(['x', 'y', 'z'], rows)).slice(1)).toEqual(rows);
  });
});

describe('importCsv', () => {
  it('reads a Chrome export', () => {
    const csv = 'name,url,username,password\nGitHub,https://github.com,rahul,S3cr3t!';
    expect(importCsv(csv)).toEqual([
      {
        title: 'GitHub',
        username: 'rahul',
        password: 'S3cr3t!',
        urls: ['https://github.com'],
        notes: '',
        totpUri: undefined,
        type: 'login',
        autoSubmit: false,
      },
    ]);
  });

  it('reads a Bitwarden CSV, whose columns are named differently', () => {
    const csv =
      'folder,favorite,type,name,notes,fields,login_uri,login_username,login_password,login_totp\n' +
      ',,login,GitHub,a note,,https://github.com,rahul,S3cr3t!,JBSWY3DPEHPK3PXP';
    const [entry] = importCsv(csv);
    expect(entry.title).toBe('GitHub');
    expect(entry.username).toBe('rahul');
    expect(entry.password).toBe('S3cr3t!');
    expect(entry.totpUri).toBe('JBSWY3DPEHPK3PXP');
    expect(entry.notes).toBe('a note');
  });

  it('reads a LastPass export', () => {
    const csv = 'url,username,password,extra,name,grouping,fav\nhttps://x.com,u,p,note,X,,0';
    const [entry] = importCsv(csv);
    expect(entry.title).toBe('X');
    expect(entry.notes).toBe('note');
  });

  it('never imports auto-login as enabled', () => {
    // No export format records it, and it is a decision per credential.
    const csv = 'name,username,password\nA,u,p';
    expect(importCsv(csv)[0].autoSubmit).toBe(false);
  });

  it('falls back to the host when a row has no name', () => {
    const csv = 'name,url,username,password\n,https://github.com/login,rahul,p';
    expect(importCsv(csv)[0].title).toBe('github.com');
  });

  it('skips folder rows and blanks rather than importing empty items', () => {
    const csv = 'name,url,username,password\nMy Folder,,,\nGitHub,https://github.com,rahul,p';
    expect(importCsv(csv)).toHaveLength(1);
  });

  it('explains a file with no credentials rather than importing nothing silently', () => {
    expect(() => importCsv('a,b\n1,2')).toThrow(/no credentials found/i);
  });

  it('explains an empty file', () => {
    expect(() => importCsv('')).toThrow(ParseError);
  });
});

describe('importBitwardenJson', () => {
  const file = {
    items: [
      {
        name: 'GitHub',
        favorite: true,
        notes: 'a note',
        login: {
          username: 'rahul',
          password: 'S3cr3t!',
          totp: 'JBSWY3DPEHPK3PXP',
          uris: [{ uri: 'https://github.com' }],
        },
      },
      { name: 'A secure note', notes: 'no login here' },
    ],
  };

  it('reads logins and carries TOTP and favourites across', () => {
    const [entry] = importBitwardenJson(file);
    expect(entry.title).toBe('GitHub');
    expect(entry.urls).toEqual(['https://github.com']);
    expect(entry.totpUri).toBe('JBSWY3DPEHPK3PXP');
    expect(entry.favorite).toBe(true);
  });

  it('skips items that are not logins', () => {
    expect(importBitwardenJson(file)).toHaveLength(1);
  });

  it('accepts the file as text', () => {
    expect(importBitwardenJson(JSON.stringify(file))).toHaveLength(1);
  });

  it('rejects a file that is not a Bitwarden export', () => {
    expect(() => importBitwardenJson('{"a":1}')).toThrow(ParseError);
  });
});

describe('importAny', () => {
  it('detects Bitwarden JSON', () => {
    const result = importAny(JSON.stringify({ items: [{ name: 'A', login: { password: 'p' } }] }));
    expect(result.format).toBe('Bitwarden JSON');
  });

  it('detects CSV', () => {
    expect(importAny('name,username,password\nA,u,p', 'export.csv').format).toBe('CSV');
  });

  it('points a KeyVault backup at the right feature', () => {
    // Restoring a backup and importing a foreign export are different
    // operations, and confusing them wastes the user's time.
    expect(() => importAny('{"format":"keyvault.backup"}')).toThrow(/Restore from backup/);
  });

  it('rejects something it cannot recognise', () => {
    expect(() => importAny('just some text', 'notes.txt')).toThrow(ParseError);
  });
});
