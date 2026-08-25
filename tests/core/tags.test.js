import { describe, it, expect } from 'vitest';
import {
  normaliseTag,
  normaliseTags,
  tagKey,
  tagCounts,
  hasTag,
  suggestTags,
  MAX_TAG_LENGTH,
} from '../../src/core/tags.js';

describe('normaliseTag', () => {
  it('trims and collapses inner whitespace', () => {
    // "needs  rotating" and "needs rotating" are the same tag typed twice.
    expect(normaliseTag('  needs   rotating ')).toBe('needs rotating');
  });

  it('preserves the capitalisation somebody chose', () => {
    // Lowercasing outright is simpler and shouts "Work" back as "work" at
    // someone who capitalised it deliberately.
    expect(normaliseTag('Work')).toBe('Work');
  });

  it('rejects a tag that is only whitespace', () => {
    for (const value of ['', '   ', '\t\n']) {
      expect(normaliseTag(value)).toBeNull();
    }
  });

  it('rejects anything that is not a string', () => {
    for (const value of [null, undefined, 42, {}, []]) {
      expect(normaliseTag(value)).toBeNull();
    }
  });

  it('truncates a tag long enough to wreck a list', () => {
    expect(normaliseTag('x'.repeat(200))).toHaveLength(MAX_TAG_LENGTH);
  });
});

describe('normaliseTags', () => {
  it('folds case-insensitive duplicates together', () => {
    // Without this the sidebar fills with near-duplicates that split the very
    // grouping the tags were for.
    expect(normaliseTags(['Work', 'work', 'WORK'])).toEqual(['Work']);
  });

  it('keeps the first spelling, not the last', () => {
    expect(normaliseTags(['Work', 'work'])).toEqual(['Work']);
    expect(normaliseTags(['work', 'Work'])).toEqual(['work']);
  });

  it('drops blanks and junk without dropping the rest', () => {
    expect(normaliseTags(['a', '', null, 'b', 42])).toEqual(['a', 'b']);
  });

  it('returns an empty list for a non-array', () => {
    for (const value of [null, undefined, 'work', {}]) {
      expect(normaliseTags(value)).toEqual([]);
    }
  });
});

describe('tagKey', () => {
  it('compares case-insensitively', () => {
    expect(tagKey('Work')).toBe(tagKey('work'));
  });
});

describe('tagCounts', () => {
  const entries = [
    { tags: ['work', 'finance'] },
    { tags: ['Work'] },
    { tags: ['work', 'archive'] },
    { tags: ['deleted-tag'], deletedAt: 1 },
  ];

  it('counts across differing capitalisations', () => {
    expect(tagCounts(entries)[0]).toEqual({ tag: 'work', count: 3 });
  });

  it('excludes trashed entries', () => {
    // A tag surviving only on a deleted item would keep a dead row in the
    // sidebar that nothing can be filtered to.
    expect(tagCounts(entries).map((t) => t.tag)).not.toContain('deleted-tag');
  });

  it('orders by use, then alphabetically', () => {
    // The tail stays predictable rather than shuffling as counts change.
    expect(tagCounts(entries).map((t) => t.tag)).toEqual(['work', 'archive', 'finance']);
  });

  it('handles an empty vault', () => {
    expect(tagCounts([])).toEqual([]);
    expect(tagCounts(null)).toEqual([]);
  });
});

describe('hasTag', () => {
  it('matches regardless of case', () => {
    expect(hasTag({ tags: ['Work'] }, 'work')).toBe(true);
    expect(hasTag({ tags: ['work'] }, 'WORK')).toBe(true);
  });

  it('is false when absent, and does not throw on a bare entry', () => {
    expect(hasTag({ tags: ['work'] }, 'home')).toBe(false);
    expect(hasTag({}, 'work')).toBe(false);
    expect(hasTag(null, 'work')).toBe(false);
  });
});

describe('suggestTags', () => {
  const entries = [{ tags: ['finance', 'family'] }, { tags: ['finance'] }, { tags: ['work'] }];

  it('suggests only tags that already exist', () => {
    // An autocomplete that invents tags is how a vault ends up with
    // "finances" beside "finance".
    expect(suggestTags(entries, 'fin')).toEqual(['finance']);
    expect(suggestTags(entries, 'zzz')).toEqual([]);
  });

  it('matches anywhere in the tag, not only the start', () => {
    expect(suggestTags(entries, 'ork')).toEqual(['work']);
  });

  it('offers the most used first when nothing is typed', () => {
    expect(suggestTags(entries, '')[0]).toBe('finance');
  });

  it('respects the limit', () => {
    expect(suggestTags(entries, '', 2)).toHaveLength(2);
  });
});
