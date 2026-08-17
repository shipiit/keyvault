import { describe, it, expect } from 'vitest';
import {
  generatePassword,
  generatePassphrase,
  passwordEntropyBits,
  passphraseEntropyBits,
  wordlistSize,
  DEFAULT_OPTIONS,
  MIN_LENGTH,
  MAX_LENGTH,
} from '../../src/core/generator.js';

describe('generatePassword', () => {
  it('produces the requested length', () => {
    for (const length of [8, 12, 20, 64, 128]) {
      expect(generatePassword({ length })).toHaveLength(length);
    }
  });

  it('defaults to a strong length with every class enabled', () => {
    expect(DEFAULT_OPTIONS.length).toBeGreaterThanOrEqual(16);
    expect(generatePassword()).toHaveLength(DEFAULT_OPTIONS.length);
  });

  it('guarantees at least one character from every enabled class', () => {
    // Without this, a 12-character password with symbols on lacks a symbol
    // roughly one time in forty — and the site then rejects it, which users
    // experience as the generator being broken.
    for (let i = 0; i < 200; i += 1) {
      const password = generatePassword({ length: 12 });
      expect(password, password).toMatch(/[a-z]/);
      expect(password, password).toMatch(/[A-Z]/);
      expect(password, password).toMatch(/\d/);
      expect(password, password).toMatch(/[!@#$%^&*()\-_=+[\]{};:,.?]/);
    }
  });

  it('honours disabled classes', () => {
    const letters = generatePassword({ length: 40, digits: false, symbols: false });
    expect(letters).toMatch(/^[A-Za-z]+$/);

    const digits = generatePassword({
      length: 20,
      lowercase: false,
      uppercase: false,
      symbols: false,
    });
    expect(digits).toMatch(/^\d+$/);
  });

  it('avoids visually ambiguous characters by default', () => {
    // l/I/1 and O/0 are the characters people transcribe wrongly.
    const sample = Array.from({ length: 60 }, () => generatePassword({ length: 40 })).join('');
    expect(sample).not.toMatch(/[lIO01]/);
  });

  it('includes ambiguous characters when asked', () => {
    const sample = Array.from({ length: 80 }, () =>
      generatePassword({ length: 40, avoidAmbiguous: false }),
    ).join('');
    expect(sample).toMatch(/[lIO01]/);
  });

  it('does not place the guaranteed characters in a fixed order', () => {
    // The guaranteed characters are appended by class, so without a shuffle
    // every password would begin lower, upper, digit, symbol — a pattern an
    // attacker could exploit directly.
    const firsts = new Set(
      Array.from({ length: 200 }, () => {
        const c = generatePassword({ length: 20 })[0];
        if (/[a-z]/.test(c)) return 'lower';
        if (/[A-Z]/.test(c)) return 'upper';
        if (/\d/.test(c)) return 'digit';
        return 'symbol';
      }),
    );
    expect(firsts.size).toBe(4);
  });

  it('never repeats a password', () => {
    const seen = new Set(Array.from({ length: 500 }, () => generatePassword({ length: 20 })));
    expect(seen.size).toBe(500);
  });

  it('distributes characters without obvious bias', () => {
    // A modulo-based generator skews toward the start of the pool. This would
    // catch that regression.
    const counts = new Map();
    const sample = Array.from({ length: 400 }, () =>
      generatePassword({ length: 40, uppercase: false, digits: false, symbols: false }),
    ).join('');
    for (const character of sample) {
      counts.set(character, (counts.get(character) ?? 0) + 1);
    }
    const frequencies = [...counts.values()];
    const expected = sample.length / counts.size;
    for (const frequency of frequencies) {
      expect(Math.abs(frequency - expected) / expected).toBeLessThan(0.25);
    }
  });

  it('rejects an out-of-range length', () => {
    expect(() => generatePassword({ length: MIN_LENGTH - 1 })).toThrow(RangeError);
    expect(() => generatePassword({ length: MAX_LENGTH + 1 })).toThrow(RangeError);
    expect(() => generatePassword({ length: 12.5 })).toThrow(RangeError);
  });

  it('rejects every class being disabled', () => {
    expect(() =>
      generatePassword({ lowercase: false, uppercase: false, digits: false, symbols: false }),
    ).toThrow(RangeError);
  });
});

describe('generatePassphrase', () => {
  it('produces the requested number of words', () => {
    expect(generatePassphrase({ words: 5 }).split('-')).toHaveLength(5);
  });

  it('uses the requested separator', () => {
    expect(generatePassphrase({ words: 4, separator: '.' }).split('.')).toHaveLength(4);
  });

  it('capitalises when asked', () => {
    expect(generatePassphrase({ words: 4, capitalize: true })).toMatch(/^[A-Z]/);
  });

  it('adds a digit when asked, not always in the same place', () => {
    const phrases = Array.from({ length: 100 }, () =>
      generatePassphrase({ words: 4, includeNumber: true }),
    );
    for (const phrase of phrases) {
      expect(phrase).toMatch(/\d/);
    }
    // The digit's position carries entropy too, so it must vary.
    const positions = new Set(
      phrases.map((phrase) => phrase.split('-').findIndex((word) => /\d/.test(word))),
    );
    expect(positions.size).toBeGreaterThan(1);
  });

  it('rejects an out-of-range word count', () => {
    expect(() => generatePassphrase({ words: 2 })).toThrow(RangeError);
    expect(() => generatePassphrase({ words: 13 })).toThrow(RangeError);
  });
});

describe('entropy reporting', () => {
  it('reports password entropy from the actual pool size', () => {
    // 20 chars from a ~80-character pool is comfortably over 120 bits.
    expect(passwordEntropyBits({ length: 20 })).toBeGreaterThan(120);
    expect(
      passwordEntropyBits({ length: 8, digits: false, symbols: false, uppercase: false }),
    ).toBe(Math.round(8 * Math.log2(25)));
  });

  it('scales with length', () => {
    expect(passwordEntropyBits({ length: 40 })).toBeGreaterThan(
      passwordEntropyBits({ length: 20 }),
    );
  });

  it('returns zero when no class is enabled', () => {
    expect(
      passwordEntropyBits({ lowercase: false, uppercase: false, digits: false, symbols: false }),
    ).toBe(0);
  });

  it('reports passphrase entropy honestly for the bundled wordlist', () => {
    // With a short curated list the figure is lower than an EFF-wordlist
    // passphrase, and the UI must not pretend otherwise.
    const bits = passphraseEntropyBits({ words: 4 });
    expect(bits).toBe(Math.round(4 * Math.log2(wordlistSize())));
    expect(bits).toBeLessThan(4 * Math.log2(7776));
  });

  it('credits the added digit', () => {
    expect(passphraseEntropyBits({ words: 4, includeNumber: true })).toBeGreaterThan(
      passphraseEntropyBits({ words: 4 }),
    );
  });
});
