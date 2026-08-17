import { describe, it, expect } from 'vitest';
import { computeSecurityScore, describeIssues } from '../../src/core/security-score.js';

const NOW = 1700000000000;
const YEAR = 365 * 86400000;

const entry = (id, password, extra = {}) => ({
  id,
  title: id,
  password,
  createdAt: NOW,
  passwordHistory: [],
  ...extra,
});

describe('computeSecurityScore', () => {
  it('scores a healthy vault highly', () => {
    const result = computeSecurityScore(
      [
        entry('a', 'unfurl-tractor-vivid-Quartz-99'),
        entry('b', 'meadow-Cobalt-lantern-7712-xz'),
        entry('c', 'Zephyr!granite-onyx-4418-vm'),
      ],
      { now: NOW },
    );
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.label).toBe('Excellent');
    expect(result.issues).toEqual([]);
  });

  it('detects a reused password across entries', () => {
    const result = computeSecurityScore(
      [entry('a', 'unfurl-tractor-vivid-Quartz-99'), entry('b', 'unfurl-tractor-vivid-Quartz-99')],
      { now: NOW },
    );
    expect(result.counts.reused).toBe(2);
    expect(result.score).toBeLessThan(90);
  });

  it('detects a weak password', () => {
    const result = computeSecurityScore([entry('a', 'password')], { now: NOW });
    expect(result.counts.weak).toBe(1);
    expect(result.issues[0].problems).toContain('weak');
  });

  it('flags a password unchanged for over a year', () => {
    const result = computeSecurityScore(
      [entry('a', 'unfurl-tractor-vivid-Quartz-99', { createdAt: NOW - YEAR - 86400000 })],
      { now: NOW },
    );
    expect(result.counts.old).toBe(1);
  });

  it('uses the last password change, not creation, for staleness', () => {
    const result = computeSecurityScore(
      [
        entry('a', 'unfurl-tractor-vivid-Quartz-99', {
          createdAt: NOW - YEAR * 3,
          passwordHistory: [{ password: 'old', changedAt: NOW - 86400000 }],
        }),
      ],
      { now: NOW },
    );
    expect(result.counts.old).toBe(0);
  });

  it('reports breach data as unavailable unless it was supplied', () => {
    // Scoring as though nothing were breached, when breach checking is off,
    // would show a reassuring number based on a check that never ran.
    const result = computeSecurityScore([entry('a', 'unfurl-tractor-vivid-Quartz-99')], {
      now: NOW,
    });
    expect(result.breachDataAvailable).toBe(false);
    expect(result.counts.breached).toBe(0);
  });

  it('counts breached entries when breach data is supplied', () => {
    const result = computeSecurityScore(
      [entry('a', 'unfurl-tractor-vivid-Quartz-99'), entry('b', 'meadow-Cobalt-lantern-7712-xz')],
      { now: NOW, breachedIds: ['a'] },
    );
    expect(result.breachDataAvailable).toBe(true);
    expect(result.counts.breached).toBe(1);
    expect(result.issues[0].id).toBe('a');
  });

  it('ranks the worst issues first', () => {
    const result = computeSecurityScore(
      [entry('weak-one', 'password'), entry('breached-one', 'meadow-Cobalt-lantern-7712-xz')],
      { now: NOW, breachedIds: ['breached-one'] },
    );
    expect(result.issues[0].id).toBe('breached-one');
  });

  it('does not let one bad entry sink a large vault', () => {
    const entries = [
      entry('bad', 'password'),
      ...Array.from({ length: 20 }, (_, i) => entry(`good-${i}`, `unfurl-tractor-vivid-Q${i}z9`)),
    ];
    const result = computeSecurityScore(entries, { now: NOW });
    expect(result.score).toBeGreaterThan(90);
  });

  it('scores a vault of only bad passwords as at risk', () => {
    const result = computeSecurityScore(
      [entry('a', 'password'), entry('b', '123456'), entry('c', 'qwerty')],
      { now: NOW },
    );
    expect(result.score).toBeLessThan(50);
    expect(result.label).toBe('At risk');
  });

  it('handles an empty vault without dividing by zero', () => {
    const result = computeSecurityScore([], { now: NOW });
    expect(result.score).toBe(100);
    expect(result.checked).toBe(0);
    expect(result.label).toBe('Nothing to check');
  });

  it('ignores entries with no password', () => {
    const result = computeSecurityScore([entry('note', ''), entry('a', 'password')], { now: NOW });
    expect(result.checked).toBe(1);
  });

  it('never returns a score outside 0-100', () => {
    const many = Array.from({ length: 30 }, (_, i) => entry(`e${i}`, 'password'));
    const result = computeSecurityScore(many, { now: NOW, breachedIds: many.map((e) => e.id) });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

describe('describeIssues', () => {
  it('describes each issue kind with a count', () => {
    const described = describeIssues({ breached: 1, reused: 3, weak: 0, old: 2 });
    expect(described.map((d) => d.kind)).toEqual(['breached', 'reused', 'old']);
    expect(described[0].text).toBe('1 password appear in known breaches');
    expect(described[1].text).toBe('3 passwords are used on more than one site');
  });

  it('returns nothing for a clean vault', () => {
    expect(describeIssues({ breached: 0, reused: 0, weak: 0, old: 0 })).toEqual([]);
  });
});
