import { randomId } from './random.js';

/**
 * Retained previous passwords per entry.
 *
 * Capped because an unbounded list grows the encrypted vault indefinitely and
 * keeps every password the user has ever used available to anyone who unlocks
 * it. Old passwords are a liability, not an archive.
 */
export const MAX_PASSWORD_HISTORY = 10;

/** Fields a caller may never set directly through create or update. */
const IMMUTABLE_FIELDS = ['id', 'createdAt', 'passwordHistory'];

/**
 * Item kinds.
 *
 * `login` is the only one autofill acts on. The rest are storage: a card or a
 * passport number must never be offered to a login form, so the type is the
 * gate rather than a label. `entriesForUrl` and the fill path both filter on
 * it.
 */
export const ENTRY_TYPES = Object.freeze(['login', 'note', 'card', 'identity', 'document']);

/** @param {unknown} value */
function normaliseType(value) {
  return ENTRY_TYPES.includes(value) ? value : 'login';
}

/**
 * @param {object} fields
 * @param {number} [now] milliseconds since epoch
 * @returns {object} a new entry
 */
export function createEntry(fields = {}, now = Date.now()) {
  const title = typeof fields.title === 'string' ? fields.title.trim() : '';
  if (title === '') {
    throw new RangeError('entry title is required');
  }
  return {
    id: randomId(),
    type: normaliseType(fields.type),
    title,
    username: fields.username ?? '',
    password: fields.password ?? '',
    urls: Array.isArray(fields.urls) ? [...fields.urls] : [],
    totp: fields.totp ?? null,
    notes: fields.notes ?? '',
    folderId: fields.folderId ?? null,
    tags: Array.isArray(fields.tags) ? [...fields.tags] : [],
    // Strict `=== true`: auto-submit is opt-in per entry, and a truthy
    // string or 1 arriving from an importer must not silently enable it.
    autoSubmit: fields.autoSubmit === true,
    favorite: fields.favorite === true,
    fields: typeof fields.fields === 'object' && fields.fields !== null ? { ...fields.fields } : {},
    passwordHistory: [],
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
  };
}

/**
 * Return a new entry with `changes` applied. Never mutates the input.
 *
 * @param {object} entry
 * @param {object} changes
 * @param {number} [now]
 * @returns {object}
 */
export function updateEntry(entry, changes = {}, now = Date.now()) {
  const safe = { ...changes };
  for (const field of IMMUTABLE_FIELDS) {
    delete safe[field];
  }

  if (safe.type !== undefined) {
    safe.type = normaliseType(safe.type);
  }
  if (safe.title !== undefined) {
    const title = String(safe.title).trim();
    if (title === '') {
      throw new RangeError('entry title cannot be empty');
    }
    safe.title = title;
  }

  // An entry whose password was empty has no prior password worth keeping.
  const passwordChanged =
    safe.password !== undefined && safe.password !== entry.password && entry.password !== '';

  const passwordHistory = passwordChanged
    ? [{ password: entry.password, changedAt: now }, ...entry.passwordHistory].slice(
        0,
        MAX_PASSWORD_HISTORY,
      )
    : entry.passwordHistory;

  return { ...entry, ...safe, passwordHistory, updatedAt: now };
}
