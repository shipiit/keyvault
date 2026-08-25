/**
 * Tags.
 *
 * The vault's only cross-cutting way of organising. Categories are fixed and
 * decided by the item's type; folders form a tree and force one home per
 * item. A login can be `work` and `finance` and `needs-rotating` at once, and
 * nothing else in the model expresses that.
 *
 * Normalisation is the whole substance of this module. Tags are typed by
 * hand, repeatedly, over years — so "Work", "work" and " work " will all be
 * entered, and without folding them together the sidebar slowly fills with
 * near-duplicates that split the very grouping the tags were for.
 */

/** Longer than this is a note, not a tag, and it wrecks any list it appears in. */
export const MAX_TAG_LENGTH = 32;

/**
 * Fold a typed tag into its canonical form, or null if it is not a tag.
 *
 * Case is preserved as typed for display, but comparison is
 * case-insensitive — see `tagKey`. Lowercasing outright would be simpler and
 * would also shout back "Work" as "work" at somebody who deliberately
 * capitalised it.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
export function normaliseTag(value) {
  if (typeof value !== 'string') {
    return null;
  }
  // Inner runs of whitespace collapse too: "needs  rotating" and
  // "needs rotating" are the same tag typed twice.
  const cleaned = value.trim().replace(/\s+/g, ' ');
  if (cleaned === '') {
    return null;
  }
  return cleaned.slice(0, MAX_TAG_LENGTH);
}

/**
 * The key two tags are considered equal by.
 *
 * @param {string} tag
 * @returns {string}
 */
export function tagKey(tag) {
  return String(tag).toLocaleLowerCase();
}

/**
 * Normalise a list, dropping blanks and case-insensitive duplicates.
 *
 * First spelling wins, so the capitalisation somebody chose is the one that
 * survives rather than whichever happened to be saved last.
 *
 * @param {unknown[]} tags
 * @returns {string[]}
 */
export function normaliseTags(tags) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(tags) ? tags : []) {
    const tag = normaliseTag(raw);
    if (tag === null) {
      continue;
    }
    const key = tagKey(tag);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/**
 * Every tag in use, with how many live entries carry it.
 *
 * Sorted by count then alphabetically: the tags actually being used rise to
 * the top, and the tail stays predictable rather than shuffling as counts
 * change.
 *
 * @param {object[]} entries
 * @returns {Array<{tag: string, count: number}>}
 */
export function tagCounts(entries) {
  const counts = new Map();
  for (const entry of entries ?? []) {
    if (typeof entry?.deletedAt === 'number') {
      continue;
    }
    for (const tag of normaliseTags(entry?.tags)) {
      const key = tagKey(tag);
      const existing = counts.get(key);
      if (existing === undefined) {
        counts.set(key, { tag, count: 1 });
      } else {
        existing.count += 1;
      }
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * Does an entry carry this tag?
 *
 * @param {object} entry
 * @param {string} tag
 * @returns {boolean}
 */
export function hasTag(entry, tag) {
  const key = tagKey(tag);
  return normaliseTags(entry?.tags).some((candidate) => tagKey(candidate) === key);
}

/**
 * Suggest tags for a partially typed one.
 *
 * Existing tags only. Suggesting nothing when nothing matches is the point:
 * an autocomplete that invents tags is how a vault ends up with `finances`
 * beside `finance`.
 *
 * @param {object[]} entries
 * @param {string} input
 * @param {number} [limit]
 * @returns {string[]}
 */
export function suggestTags(entries, input, limit = 6) {
  const needle = tagKey(normaliseTag(input) ?? '');
  return tagCounts(entries)
    .filter(({ tag }) => needle === '' || tagKey(tag).includes(needle))
    .slice(0, limit)
    .map(({ tag }) => tag);
}
