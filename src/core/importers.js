import { parseCsvObjects } from './csv.js';
import { ParseError } from './errors.js';

/**
 * Reading exports from other password managers.
 *
 * Each product names its columns differently, and the same product renames
 * them between versions, so every importer maps by a list of aliases rather
 * than one fixed header. A column that moves should degrade to a missing
 * field, never to a password imported into the wrong slot.
 *
 * These files are plaintext by definition — that is what an export is — so
 * nothing here writes anywhere. It converts rows to entry fields and hands
 * them straight back for the caller to store encrypted.
 */

/**
 * First non-empty value among the candidate column names.
 *
 * @param {Record<string, string>} row
 * @param {string[]} names
 * @returns {string}
 */
function pick(row, names) {
  for (const name of names) {
    const value = row[name];
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }
  return '';
}

/** Column aliases seen across products and versions. */
const COLUMNS = {
  title: ['name', 'title', 'account', 'item name', 'display name'],
  username: ['username', 'login_username', 'user name', 'login', 'email', 'user'],
  password: ['password', 'login_password', 'pass'],
  url: ['url', 'login_uri', 'website', 'web site', 'site', 'uri', 'login_url'],
  notes: ['notes', 'note', 'comments', 'extra'],
  totp: ['totp', 'otpauth', 'login_totp', 'one-time password', 'otp'],
};

/**
 * Convert one CSV row to entry fields.
 *
 * @param {Record<string, string>} row
 * @returns {object|null} null when the row carries nothing worth storing
 */
function rowToEntry(row) {
  const title = pick(row, COLUMNS.title);
  const username = pick(row, COLUMNS.username);
  const password = pick(row, COLUMNS.password);
  const url = pick(row, COLUMNS.url);
  const totp = pick(row, COLUMNS.totp);

  // A row with no password and no note is a folder marker or a blank line,
  // not a credential.
  const notes = pick(row, COLUMNS.notes);
  if (password === '' && notes === '' && totp === '') {
    return null;
  }

  return {
    // Falling back to the host keeps an untitled row identifiable rather
    // than importing a wall of "Untitled".
    title: title !== '' ? title : hostOf(url) || username || 'Imported item',
    username,
    password,
    urls: url === '' ? [] : [url],
    notes,
    totpUri: totp === '' ? undefined : totp,
    type: 'login',
    // Never inherited from an import. Auto-login is a decision the user
    // makes per credential, and no export format records it.
    autoSubmit: false,
  };
}

/** @param {string} url */
function hostOf(url) {
  try {
    return new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`).hostname;
  } catch {
    return '';
  }
}

/**
 * Import a CSV export.
 *
 * Covers 1Password, Bitwarden, LastPass, Chrome, Edge, Safari and Firefox:
 * they differ only in column names, which the alias table absorbs.
 *
 * @param {string} text
 * @returns {object[]} entry fields
 */
export function importCsv(text) {
  const rows = parseCsvObjects(text);
  if (rows.length === 0) {
    throw new ParseError('that file has no rows, or no header line');
  }

  const entries = rows.map(rowToEntry).filter((entry) => entry !== null);
  if (entries.length === 0) {
    throw new ParseError(
      'no credentials found. The file may not be a password export, or its columns may be ' +
        'named unusually.',
    );
  }
  return entries;
}

/**
 * Import a Bitwarden JSON export.
 *
 * Bitwarden's JSON carries more than its CSV — folders, item types, TOTP —
 * so it is worth reading directly rather than asking the user to re-export.
 *
 * @param {string|object} input
 * @returns {object[]} entry fields
 */
export function importBitwardenJson(input) {
  const parsed = typeof input === 'string' ? parseJson(input) : input;
  if (!Array.isArray(parsed?.items)) {
    throw new ParseError('not a Bitwarden JSON export');
  }

  return parsed.items
    .filter((item) => item.login !== undefined && item.login !== null)
    .map((item) => ({
      title: item.name ?? 'Imported item',
      username: item.login.username ?? '',
      password: item.login.password ?? '',
      urls: (item.login.uris ?? []).map((entry) => entry.uri).filter(Boolean),
      notes: item.notes ?? '',
      totpUri: item.login.totp ?? undefined,
      type: 'login',
      favorite: item.favorite === true,
      autoSubmit: false,
    }));
}

/**
 * Pick an importer from the file itself.
 *
 * Sniffed rather than chosen by the user: asking someone to identify their
 * own export format is a question they should not have to answer, and
 * getting it wrong is recoverable here but confusing there.
 *
 * @param {string} text
 * @param {string} [filename]
 * @returns {{entries: object[], format: string}}
 */
export function importAny(text, filename = '') {
  const trimmed = text.trimStart();

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const parsed = parseJson(text);
    if (Array.isArray(parsed?.items)) {
      return { entries: importBitwardenJson(parsed), format: 'Bitwarden JSON' };
    }
    throw new ParseError(
      'that JSON file is not a format KeyVault recognises. For a KeyVault backup, use Restore ' +
        'from backup instead.',
    );
  }

  if (filename.toLowerCase().endsWith('.csv') || trimmed.includes(',')) {
    return { entries: importCsv(text), format: 'CSV' };
  }

  throw new ParseError('unrecognised file. Export your passwords as CSV and try again.');
}

/** @param {string} text */
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new ParseError('that file is not valid JSON', { cause });
  }
}
