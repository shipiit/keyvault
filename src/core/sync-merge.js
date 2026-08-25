/**
 * Merging two copies of a vault.
 *
 * This is the part of sync that loses people's passwords, so it is pure: no
 * storage, no network, no clock. Give it three vaults and it returns a
 * fourth, with a report of what it did.
 *
 * The merge is three-way. Two-way merging cannot tell "I added this" from
 * "they deleted this" — both look like an entry present on one side only —
 * so every sync remembers the state it last agreed with (the **base**) and
 * compares both sides against it.
 *
 * Two rules carry the safety of the whole feature:
 *
 * **A conflict produces both versions, never a winner.** Any rule that picks
 * one — newest, longest, local — silently destroys somebody's password some
 * of the time. A duplicate is visible and takes two clicks to resolve; a lost
 * password is a support request that cannot be answered.
 *
 * **An edit beats a delete.** If one machine deleted an entry while another
 * edited it, the entry comes back. Losing an edit is invisible; a resurrected
 * item is obvious and can be deleted again.
 *
 * Ordering uses each entry's `rev` counter rather than `updatedAt`. Clocks
 * across machines disagree, and one laptop set to the wrong year would
 * otherwise win every conflict forever.
 */

import { randomId } from './random.js';

/** Fields that describe the record rather than its content. */
const BOOKKEEPING = Object.freeze(['rev', 'updatedAt', 'lastUsedAt']);

/**
 * Do two entries hold the same content?
 *
 * Bookkeeping is ignored: two machines that made the identical edit have not
 * conflicted, even though their counters differ. `lastUsedAt` in particular
 * changes just from filling a form, and treating that as a conflict would
 * produce duplicates for doing nothing at all.
 *
 * @param {object} a
 * @param {object} b
 */
export function sameContent(a, b) {
  const strip = (entry) => {
    const copy = { ...entry };
    for (const field of BOOKKEEPING) {
      delete copy[field];
    }
    return JSON.stringify(copy, Object.keys(copy).sort());
  };
  return strip(a) === strip(b);
}

/** @param {object|undefined} entry */
function isDeleted(entry) {
  return typeof entry?.deletedAt === 'number';
}

/**
 * Did this side change relative to base?
 *
 * An entry absent from base is new, which counts as a change. An entry whose
 * counter matches base has not been touched.
 */
function changed(side, base) {
  if (side === undefined) {
    return false;
  }
  if (base === undefined) {
    return true;
  }
  return (side.rev ?? 0) !== (base.rev ?? 0);
}

/**
 * Merge two vaults against the state they last agreed on.
 *
 * @param {object} options
 * @param {object[]} options.base entries at the last successful sync, or []
 * @param {object[]} options.local
 * @param {object[]} options.remote
 * @param {string} [options.remoteName] shown in a conflict copy's title
 * @param {number} [options.now]
 * @param {() => string} [options.newId] injectable for deterministic tests
 * @returns {{entries: object[], report: object}}
 */
export function mergeVaults({
  base = [],
  local = [],
  remote = [],
  remoteName = 'another device',
  now = Date.now(),
  newId = randomId,
}) {
  const byId = (list) => new Map((list ?? []).map((entry) => [entry.id, entry]));
  const baseMap = byId(base);
  const localMap = byId(local);
  const remoteMap = byId(remote);

  const merged = [];
  const report = {
    unchanged: 0,
    fromLocal: 0,
    fromRemote: 0,
    conflicts: [],
    resurrected: [],
  };

  const ids = new Set([...localMap.keys(), ...remoteMap.keys()]);

  for (const id of ids) {
    const b = baseMap.get(id);
    const l = localMap.get(id);
    const r = remoteMap.get(id);

    // Present on one side only. If base knew about it, the other side
    // deleted it *hard* — which this model never does, so treat an absence
    // as "not yet arrived" and keep what we have. Never drop an entry
    // because it is missing from one copy.
    if (l === undefined) {
      merged.push(r);
      report.fromRemote += 1;
      continue;
    }
    if (r === undefined) {
      merged.push(l);
      report.fromLocal += 1;
      continue;
    }

    const localChanged = changed(l, b);
    const remoteChanged = changed(r, b);

    if (!localChanged && !remoteChanged) {
      merged.push(l);
      report.unchanged += 1;
      continue;
    }
    if (localChanged && !remoteChanged) {
      merged.push(l);
      report.fromLocal += 1;
      continue;
    }
    if (!localChanged && remoteChanged) {
      merged.push(r);
      report.fromRemote += 1;
      continue;
    }

    // Both changed.
    if (sameContent(l, r)) {
      // The same edit made twice is not a disagreement. Keep the higher
      // counter so neither side syncs it again forever.
      merged.push((l.rev ?? 0) >= (r.rev ?? 0) ? l : r);
      report.unchanged += 1;
      continue;
    }

    // An edit beats a delete, in either direction.
    if (isDeleted(l) !== isDeleted(r)) {
      const survivor = isDeleted(l) ? r : l;
      merged.push(survivor);
      report.resurrected.push({ id, title: survivor.title });
      continue;
    }

    // A genuine disagreement. Keep both.
    merged.push(l);
    const copy = {
      ...r,
      id: newId(),
      title: `${r.title} (conflict from ${remoteName})`,
      tags: [...new Set([...(r.tags ?? []), 'conflict'])],
      rev: 1,
      updatedAt: now,
    };
    merged.push(copy);
    report.conflicts.push({ id, copyId: copy.id, title: r.title });
  }

  return { entries: merged, report };
}

/**
 * A one-line summary of a merge, for the UI.
 *
 * @param {object} report
 * @returns {string}
 */
export function describeMerge(report) {
  const parts = [];
  if (report.fromRemote > 0) {
    parts.push(`${report.fromRemote} received`);
  }
  if (report.fromLocal > 0) {
    parts.push(`${report.fromLocal} sent`);
  }
  if (report.resurrected.length > 0) {
    parts.push(`${report.resurrected.length} restored (edited elsewhere after being deleted here)`);
  }
  if (report.conflicts.length > 0) {
    parts.push(`${report.conflicts.length} kept as both versions`);
  }
  return parts.length === 0 ? 'Already up to date' : parts.join(', ');
}
