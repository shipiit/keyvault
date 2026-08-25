import { assessPassword } from './password-strength.js';
import { describeCredential } from './api-credential.js';

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

  // Logins only. An API key is not "weak" in any sense this scores — it is
  // whatever length its issuer chose — and judging one by password rules
  // would fill Watchtower with findings nobody can act on, which is how a
  // security report gets ignored. Credentials have their own audit, keyed on
  // expiry and environment, in `auditCredentials` below.
  const withPasswords = entries.filter(
    (entry) =>
      typeof entry.password === 'string' &&
      entry.password !== '' &&
      (entry.type ?? 'login') === 'login',
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
  // Singular and plural phrasings are both written out. Interpolating a
  // count into one fixed phrase produces "1 password are reused", which
  // reads as a bug in the product even though the number is right.
  const descriptions = [
    ['breached', 'appears in a known breach', 'appear in known breaches'],
    ['reused', 'is used on more than one site', 'are used on more than one site'],
    ['weak', 'is easy to guess', 'are easy to guess'],
    ['old', 'has not changed in over a year', 'have not changed in over a year'],
  ];

  return descriptions
    .filter(([kind]) => counts[kind] > 0)
    .map(([kind, singular, plural]) => {
      const count = counts[kind];
      return {
        kind,
        count,
        text: `${count} ${count === 1 ? 'password' : 'passwords'} ${count === 1 ? singular : plural}`,
      };
    });
}

/**
 * The credential-side audit: expiry and environment, not strength.
 *
 * Separate from the password score on purpose. The two ask different
 * questions — "could this be guessed" versus "is this still valid, and does
 * it point at production" — and a single number that mixed them would answer
 * neither.
 *
 * @param {object[]} entries
 * @param {number} [now]
 * @returns {{expired: object[], expiring: object[], misfiled: object[], production: number,
 *            checked: number}}
 */
export function auditCredentials(entries, now = Date.now()) {
  const credentials = (entries ?? []).filter(
    (entry) => entry.type === 'apiKey' && typeof entry.deletedAt !== 'number',
  );

  const expired = [];
  const expiring = [];
  const misfiled = [];
  let production = 0;

  for (const entry of credentials) {
    const described = describeCredential(entry, now);
    const summary = {
      id: entry.id,
      title: entry.title,
      provider: described.provider,
      environment: described.environment,
      days: described.status.days,
    };
    if (described.status.state === 'expired') expired.push(summary);
    if (described.status.state === 'expiring') expiring.push(summary);
    if (described.misfiled) misfiled.push(summary);
    if (described.environment === 'production') production += 1;
  }

  // Soonest first: the one expiring tomorrow matters more than the one
  // expiring in three weeks.
  expiring.sort((a, b) => a.days - b.days);
  // Longest overdue first, for the same reason inverted.
  expired.sort((a, b) => a.days - b.days);

  return { expired, expiring, misfiled, production, checked: credentials.length };
}
