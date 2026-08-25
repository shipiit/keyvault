import { describe, it, expect } from 'vitest';
import { mergeVaults, sameContent, describeMerge } from '../../src/core/sync-merge.js';

const NOW = 1_700_000_000_000;
const ids = () => {
  let n = 0;
  return () => `copy-${(n += 1)}`;
};

const entry = (over = {}) => ({
  id: over.id ?? 'a',
  rev: over.rev ?? 1,
  title: over.title ?? 'Bank',
  password: over.password ?? 'original',
  tags: over.tags ?? [],
  deletedAt: over.deletedAt ?? null,
  archivedAt: over.archivedAt ?? null,
  updatedAt: over.updatedAt ?? NOW,
  lastUsedAt: over.lastUsedAt ?? null,
});

const merge = (base, local, remote, extra = {}) =>
  mergeVaults({ base, local, remote, now: NOW, newId: ids(), remoteName: 'MacBook', ...extra });

describe('the cases where nothing is in dispute', () => {
  it('keeps an entry neither side touched', () => {
    const b = [entry()];
    const { entries, report } = merge(b, [entry()], [entry()]);
    expect(entries).toHaveLength(1);
    expect(report.unchanged).toBe(1);
  });

  it('takes a local edit the remote has not seen', () => {
    const { entries } = merge([entry()], [entry({ rev: 2, password: 'newer' })], [entry()]);
    expect(entries[0].password).toBe('newer');
  });

  it('takes a remote edit the local has not seen', () => {
    const { entries } = merge([entry()], [entry()], [entry({ rev: 2, password: 'theirs' })]);
    expect(entries[0].password).toBe('theirs');
  });

  it('accepts an entry that is new on the remote', () => {
    const { entries, report } = merge([], [], [entry({ id: 'new' })]);
    expect(entries.map((e) => e.id)).toEqual(['new']);
    expect(report.fromRemote).toBe(1);
  });

  it('keeps an entry that is new locally and not yet uploaded', () => {
    const { entries } = merge([], [entry({ id: 'mine' })], []);
    expect(entries.map((e) => e.id)).toEqual(['mine']);
  });

  it('never drops an entry merely because one copy lacks it', () => {
    // The failure that would quietly empty a vault: treating "absent from
    // the remote" as "deleted remotely".
    const { entries } = merge([entry()], [entry()], []);
    expect(entries).toHaveLength(1);
  });
});

describe('conflicts', () => {
  it('keeps both versions when the two sides disagree', () => {
    // The rule the whole feature rests on. Picking a winner destroys a
    // password some of the time, and does it silently.
    const { entries, report } = merge(
      [entry()],
      [entry({ rev: 2, password: 'mine' })],
      [entry({ rev: 2, password: 'theirs' })],
    );
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.password).sort()).toEqual(['mine', 'theirs']);
    expect(report.conflicts).toHaveLength(1);
  });

  it('labels the copy so it can be told apart and found later', () => {
    const { entries } = merge(
      [entry()],
      [entry({ rev: 2, password: 'mine' })],
      [entry({ rev: 2, password: 'theirs' })],
    );
    const copy = entries.find((e) => e.password === 'theirs');
    expect(copy.title).toBe('Bank (conflict from MacBook)');
    expect(copy.tags).toContain('conflict');
  });

  it('gives the copy a new id, so it does not overwrite the original', () => {
    const { entries } = merge(
      [entry()],
      [entry({ rev: 2, password: 'mine' })],
      [entry({ rev: 2, password: 'theirs' })],
    );
    expect(new Set(entries.map((e) => e.id)).size).toBe(2);
  });

  it('is not a conflict when both sides made the identical edit', () => {
    // Two machines told to do the same thing have not disagreed, and a
    // duplicate for that would be pure noise.
    const { entries, report } = merge(
      [entry()],
      [entry({ rev: 2, password: 'same' })],
      [entry({ rev: 3, password: 'same' })],
    );
    expect(entries).toHaveLength(1);
    expect(report.conflicts).toHaveLength(0);
  });

  it('does not conflict over bookkeeping alone', () => {
    // lastUsedAt changes just from filling a form. Treating that as a
    // disagreement would produce duplicates for doing nothing.
    const { entries } = merge(
      [entry()],
      [entry({ rev: 2, lastUsedAt: 111 })],
      [entry({ rev: 2, lastUsedAt: 222 })],
    );
    expect(entries).toHaveLength(1);
  });
});

describe('deletion', () => {
  it('propagates a delete the other side has not seen', () => {
    const { entries } = merge([entry()], [entry()], [entry({ rev: 2, deletedAt: NOW })]);
    expect(entries[0].deletedAt).toBe(NOW);
  });

  it('lets an edit beat a delete, in either direction', () => {
    // Losing an edit is invisible. A resurrected item is obvious and takes
    // two clicks to delete again.
    const deletedHere = merge(
      [entry()],
      [entry({ rev: 2, deletedAt: NOW })],
      [entry({ rev: 2, password: 'still-wanted' })],
    );
    expect(deletedHere.entries[0].password).toBe('still-wanted');
    expect(deletedHere.entries[0].deletedAt).toBeNull();
    expect(deletedHere.report.resurrected).toHaveLength(1);

    const deletedThere = merge(
      [entry()],
      [entry({ rev: 2, password: 'still-wanted' })],
      [entry({ rev: 2, deletedAt: NOW })],
    );
    expect(deletedThere.entries[0].password).toBe('still-wanted');
  });

  it('accepts a delete both sides agree on, without a conflict copy', () => {
    const { entries, report } = merge(
      [entry()],
      [entry({ rev: 2, deletedAt: NOW })],
      [entry({ rev: 2, deletedAt: NOW })],
    );
    expect(entries).toHaveLength(1);
    expect(report.conflicts).toHaveLength(0);
  });
});

describe('ordering does not depend on the clock', () => {
  it('ignores updatedAt entirely when deciding what changed', () => {
    // One laptop set to the wrong year must not win every conflict forever.
    const { entries } = merge(
      [entry()],
      [entry({ rev: 2, password: 'correct', updatedAt: 1 })],
      [entry({ rev: 1, password: 'original', updatedAt: 9_999_999_999_999 })],
    );
    expect(entries[0].password).toBe('correct');
  });
});

describe('sameContent', () => {
  it('is insensitive to key order', () => {
    expect(sameContent({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it('ignores rev, updatedAt and lastUsedAt', () => {
    expect(sameContent(entry({ rev: 1 }), entry({ rev: 9, updatedAt: 5, lastUsedAt: 7 }))).toBe(
      true,
    );
  });

  it('notices a real difference', () => {
    expect(sameContent(entry(), entry({ password: 'other' }))).toBe(false);
  });
});

describe('describeMerge', () => {
  it('says nothing happened when nothing did', () => {
    expect(
      describeMerge({ unchanged: 3, fromLocal: 0, fromRemote: 0, conflicts: [], resurrected: [] }),
    ).toBe('Already up to date');
  });

  it('reports conflicts in plain terms', () => {
    const text = describeMerge({
      unchanged: 0,
      fromLocal: 1,
      fromRemote: 2,
      conflicts: [{}],
      resurrected: [],
    });
    expect(text).toContain('2 received');
    expect(text).toContain('1 sent');
    expect(text).toContain('both versions');
  });
});

describe('a whole round trip', () => {
  it('converges: merging twice changes nothing the second time', () => {
    // If a merge is not idempotent, two devices ping-pong forever, each
    // producing conflict copies of the other's copies.
    const base = [entry({ id: 'a' })];
    const local = [entry({ id: 'a', rev: 2, password: 'mine' }), entry({ id: 'b' })];
    const remote = [entry({ id: 'a', rev: 2, password: 'theirs' }), entry({ id: 'c' })];

    const first = merge(base, local, remote);
    const second = mergeVaults({
      base: first.entries,
      local: first.entries,
      remote: first.entries,
      now: NOW,
      newId: ids(),
    });

    expect(second.entries).toHaveLength(first.entries.length);
    expect(second.report.conflicts).toHaveLength(0);
  });
});
