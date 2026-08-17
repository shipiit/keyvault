/** Settings applied to a freshly created vault. */
export const DEFAULT_SETTINGS = Object.freeze({
  autoLockMinutes: 15,
  // Fill a matching login as the page loads. On by default because that is
  // what "autofill" means; submitting is still per entry and still off.
  autofillOnLoad: true,
  lockOnBrowserClose: true,
  clipboardClearSeconds: 30,
  theme: 'system',
  generator: Object.freeze({
    length: 20,
    uppercase: true,
    lowercase: true,
    digits: true,
    symbols: true,
    avoidAmbiguous: true,
  }),
});

/**
 * @returns {{entries: object[], folders: object[], settings: object}}
 */
export function createVaultData() {
  // Cloned, not referenced: DEFAULT_SETTINGS is frozen, and sharing it would
  // make every vault's settings the same object.
  return {
    entries: [],
    folders: [],
    settings: structuredClone(DEFAULT_SETTINGS),
  };
}

/**
 * @param {object} vault
 * @param {object} entry
 * @returns {object} new vault
 */
export function addEntry(vault, entry) {
  if (vault.entries.some((e) => e.id === entry.id)) {
    throw new RangeError(`entry already exists: ${entry.id}`);
  }
  return { ...vault, entries: [...vault.entries, entry] };
}

/**
 * @param {object} vault
 * @param {object} entry
 * @returns {object} new vault
 */
export function replaceEntry(vault, entry) {
  const index = vault.entries.findIndex((e) => e.id === entry.id);
  if (index === -1) {
    throw new RangeError(`entry not found: ${entry.id}`);
  }
  const entries = [...vault.entries];
  entries[index] = entry;
  return { ...vault, entries };
}

/**
 * @param {object} vault
 * @param {string} id
 * @returns {object} new vault
 */
export function removeEntry(vault, id) {
  const entries = vault.entries.filter((e) => e.id !== id);
  if (entries.length === vault.entries.length) {
    throw new RangeError(`entry not found: ${id}`);
  }
  return { ...vault, entries };
}

/**
 * @param {object} vault
 * @param {string} id
 * @returns {object|null}
 */
export function findEntry(vault, id) {
  return vault.entries.find((e) => e.id === id) ?? null;
}

/**
 * Substring search across title, username, URLs, and tags.
 *
 * Passwords, notes, and TOTP secrets are deliberately excluded. Including
 * them would turn the search box into an oracle — type a guessed secret at an
 * unlocked browser and see whether it matches — and would surface secret
 * material in a results list.
 *
 * @param {object} vault
 * @param {string} query
 * @returns {object[]}
 */
export function searchEntries(vault, query) {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return [...vault.entries];
  }
  return vault.entries.filter((entry) => {
    const haystack = [entry.title, entry.username, ...entry.urls, ...entry.tags]
      .join('\n')
      .toLowerCase();
    return haystack.includes(needle);
  });
}
