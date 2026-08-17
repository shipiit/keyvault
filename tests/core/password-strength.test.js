import { describe, it, expect } from 'vitest';
import {
  assessPassword,
  estimateEntropyBits,
  timeToCrack,
} from '../../src/core/password-strength.js';

describe('assessPassword', () => {
  it('flags notorious passwords as the weakest possible', () => {
    for (const password of ['password', 'PASSWORD', '123456', 'qwerty', 'letmein', 'admin']) {
      const result = assessPassword(password);
      expect(result.score, password).toBe(0);
      expect(result.warning, password).toMatch(/most common/i);
    }
  });

  it('catches a notorious password dressed up with a trailing symbol', () => {
    expect(assessPassword('password!').score).toBe(0);
  });

  it('rates a long random passphrase highly', () => {
    const result = assessPassword('unfurl-tractor-vivid-Quartz-99');
    expect(result.score).toBeGreaterThanOrEqual(3);
    expect(result.entropyBits).toBeGreaterThan(90);
  });

  it('penalises the capital-then-digits human pattern', () => {
    // "Password123!" scores far above its real strength on a naive estimator,
    // because cracking rules encode this exact shape.
    const patterned = assessPassword('Sunlight47!');
    const scrambled = assessPassword('t4S!ilnhu7g');
    expect(patterned.entropyBits).toBeLessThan(scrambled.entropyBits);
  });

  it('penalises sequential runs', () => {
    const sequential = assessPassword('abcdefgh12345678');
    expect(sequential.warning).toMatch(/predictable run/i);
    expect(sequential.entropyBits).toBeLessThan(estimateEntropyBits('xkqmzrwt94628153'));
  });

  it('penalises repeated characters', () => {
    expect(estimateEntropyBits('aaaaaaaaaaaaaaaa')).toBeLessThan(estimateEntropyBits('aq7Zm2Xp'));
  });

  it('warns about digits alone', () => {
    expect(assessPassword('99887766554433').warning).toMatch(/digits alone/i);
  });

  it('suggests length before symbols', () => {
    expect(assessPassword('Xy7!q').suggestions[0]).toMatch(/longer/i);
  });

  it('handles empty and non-string input', () => {
    expect(assessPassword('')).toEqual({
      score: 0,
      label: 'Empty',
      entropyBits: 0,
      warning: null,
      suggestions: [],
    });
    expect(assessPassword(null).score).toBe(0);
  });

  it('returns a label matching the score', () => {
    const labels = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'];
    for (const password of ['a', 'abc123XY', 'Tr0ub4dor&3x', 'unfurl-tractor-vivid-Quartz-99']) {
      const result = assessPassword(password);
      expect(labels[result.score]).toBe(result.label);
    }
  });
});

describe('timeToCrack', () => {
  it('reports trivial passwords as instant', () => {
    expect(timeToCrack(0)).toBe('instantly');
    expect(timeToCrack(20)).toBe('instantly');
  });

  it('scales with entropy', () => {
    expect(timeToCrack(50)).toMatch(/hours|minutes|days/);
    expect(timeToCrack(80)).toMatch(/years|centuries/);
    expect(timeToCrack(128)).toMatch(/million|centuries/);
  });

  it('is deliberately pessimistic, assuming a fast offline attack', () => {
    // A 60-bit password should not be reported as safe for centuries: the
    // figure has to assume the attacker's best case, not ours.
    expect(timeToCrack(60)).not.toMatch(/centuries|million/);
  });
});
