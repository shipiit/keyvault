import { assessPassword } from './password-strength.js';

/**
 * A vault-health score, computed from the vault's actual contents.
 *
 * Deliberately not a vanity number. Every point deducted maps to a specific
 * entry the user can open and fix, and `issues` names them — a score with no
 * actionable detail behind it is decoration, not security tooling.
 *
 * Breach data is optional and only present when the user has enabled breach
 * checking. When it is absent the score says so rather than silently scoring
 * as though nothing were breached.
 */

/** Weighting per issue kind. Reused and breached outrank merely weak. */
const PENALTY = Object.freeze({
  breached: 40,
  reused: 25,
  weak: 20,
  old: 5,
});

/** Passwords unchanged for longer than this are flagged as stale. */
const STALE_AFTER_DAYS = 365;

/**
 * @param {object[]} entries
 * @param {{breachedIds?: Set<string>|string[], now?: number}} [context]
 * @returns {{score: number, label: string, checked: number, issues: object[],
 *            counts: object, breachDataAvailable: boolean}}
 */
export function computeSecurityScore(entries, context = {}) {
  const now = context.now ?? Date.now();
  const breachedIds = context.breachedIds === undefined ? null : new Set(context.breachedIds);

  const withPasswords = entries.filter(
    (entry) => typeof entry.password === 'string' && entry.password !== '',
  );

  if (withPasswords.length === 0) {
    return {
      score: 100,
      label: 'Nothing to check',
      checked: 0,
      issues: [],
      counts: { breached: 0, reused: 0, weak: 0, old: 0 },
      breachDataAvailable: breachedIds !== null,
    };
  }

  // Count occurrences so reuse can be detected. Only equality matters here,
  // and this never leaves the unlocked context.
  const timesUsed = new Map();
  for (const entry of withPasswords) {
    timesUsed.set(entry.password, (timesUsed.get(entry.password) ?? 0) + 1);
  }

  const issues = [];
  const counts = { breached: 0, reused: 0, weak: 0, old: 0 };

  for (const entry of withPasswords) {
    const problems = [];

    if (breachedIds !== null && breachedIds.has(entry.id)) {
      problems.push('breached');
    }
    if (timesUsed.get(entry.password) > 1) {
      problems.push('reused');
    }
    if (assessPassword(entry.password).score <= 1) {
      problems.push('weak');
    }

    const changedAt = entry.passwordHistory?.[0]?.changedAt ?? entry.createdAt;
    if (typeof changedAt === 'number' && now - changedAt > STALE_AFTER_DAYS * 86400000) {
      problems.push('old');
    }

    if (problems.length > 0) {
      for (const problem of problems) {
        counts[problem] += 1;
      }
      issues.push({ id: entry.id, title: entry.title, problems });
    }
  }

  // Each entry can lose at most its own share of the total, so one very bad
  // entry in a large vault cannot drag the whole score to zero.
  const perEntry = 100 / withPasswords.length;
  let lost = 0;
  for (const issue of issues) {
    const worst = Math.max(...issue.problems.map((problem) => PENALTY[problem]));
    lost += Math.min(perEntry, (perEntry * worst) / 100 + perEntry * 0.4);
  }

  const score = Math.max(0, Math.min(100, Math.round(100 - lost)));

  return {
    score,
    label: labelFor(score),
    checked: withPasswords.length,
    issues: issues.sort((a, b) => severityOf(b) - severityOf(a)),
    counts,
    breachDataAvailable: breachedIds !== null,
  };
}

/** @param {object} issue */
function severityOf(issue) {
  return Math.max(...issue.problems.map((problem) => PENALTY[problem]));
}

/** @param {number} score */
function labelFor(score) {
  if (score >= 90) return 'Excellent';
  if (score >= 75) return 'Good';
  if (score >= 50) return 'Needs work';
  return 'At risk';
}

/**
 * One-line summaries, in the order they should be shown.
 *
 * @param {object} counts
 * @returns {Array<{kind: string, count: number, text: string}>}
 */
export function describeIssues(counts) {
  const descriptions = [
    ['breached', 'appear in known breaches'],
    ['reused', 'are used on more than one site'],
    ['weak', 'are easy to guess'],
    ['old', 'have not been changed in over a year'],
  ];

  return descriptions
    .filter(([kind]) => counts[kind] > 0)
    .map(([kind, phrase]) => ({
      kind,
      count: counts[kind],
      text: `${counts[kind]} ${counts[kind] === 1 ? 'password' : 'passwords'} ${phrase}`,
    }));
}
