import { describe, it, expect } from 'vitest';
import { randomBytes, randomInt, randomId, pickRandom } from '../../src/core/random.js';

describe('randomBytes', () => {
  it('returns the requested length', () => {
    expect(randomBytes(16).length).toBe(16);
    expect(randomBytes(0).length).toBe(0);
  });

  it('does not repeat across calls', () => {
    const a = randomBytes(32);
    const b = randomBytes(32);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it('rejects negative or non-integer lengths', () => {
    expect(() => randomBytes(-1)).toThrow(RangeError);
    expect(() => randomBytes(1.5)).toThrow(RangeError);
  });
});

describe('randomInt', () => {
  it('stays within [0, max)', () => {
    for (let i = 0; i < 500; i += 1) {
      const n = randomInt(10);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(10);
    }
  });

  it('covers the whole range over many draws', () => {
    const seen = new Set();
    for (let i = 0; i < 2000; i += 1) seen.add(randomInt(8));
    expect(seen.size).toBe(8);
  });

  it('always returns 0 when max is 1', () => {
    for (let i = 0; i < 20; i += 1) expect(randomInt(1)).toBe(0);
  });

  it('is unbiased for non-power-of-two bounds', () => {
    // Rejection sampling means each bucket should land near 1/3 of draws.
    // A modulo-reduction implementation would skew measurably here.
    const counts = [0, 0, 0];
    const draws = 30000;
    for (let i = 0; i < draws; i += 1) counts[randomInt(3)] += 1;
    for (const c of counts) {
      expect(Math.abs(c / draws - 1 / 3)).toBeLessThan(0.02);
    }
  });

  it('rejects max < 1', () => {
    expect(() => randomInt(0)).toThrow(RangeError);
    expect(() => randomInt(-5)).toThrow(RangeError);
    expect(() => randomInt(2.5)).toThrow(RangeError);
  });
});

describe('randomId', () => {
  it('returns a v4 UUID', () => {
    expect(randomId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('is unique across calls', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => randomId()));
    expect(ids.size).toBe(1000);
  });
});

describe('pickRandom', () => {
  it('returns a member of the input', () => {
    const items = ['a', 'b', 'c'];
    for (let i = 0; i < 100; i += 1) {
      expect(items).toContain(pickRandom(items));
    }
  });

  it('throws on an empty collection', () => {
    expect(() => pickRandom([])).toThrow(RangeError);
  });
});
