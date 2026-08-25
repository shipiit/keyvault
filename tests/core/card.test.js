import { describe, it, expect } from 'vitest';
import {
  detectBrand,
  passesLuhn,
  formatNumber,
  maskNumber,
  isExpired,
  digitsOf,
  describeCard,
} from '../../src/core/card.js';

/** The industry's published test numbers. None is a real card. */
const VISA = '4111111111111111';
const MASTERCARD = '5555555555554444';
const MC_NEW_RANGE = '2223003122003222';
const AMEX = '378282246310005';
const DISCOVER = '6011111111111117';

describe('digitsOf', () => {
  it('accepts a number typed the way it is printed', () => {
    // People copy from a physical card, in groups.
    expect(digitsOf('4111 1111 1111 1111')).toBe(VISA);
    expect(digitsOf('4111-1111-1111-1111')).toBe(VISA);
  });

  it('is empty for anything that is not a string', () => {
    for (const value of [null, undefined, 42, {}]) {
      expect(digitsOf(value)).toBe('');
    }
  });
});

describe('detectBrand', () => {
  it('names the major issuers', () => {
    expect(detectBrand(VISA).brand).toBe('Visa');
    expect(detectBrand(MASTERCARD).brand).toBe('Mastercard');
    expect(detectBrand(AMEX).brand).toBe('American Express');
    expect(detectBrand(DISCOVER).brand).toBe('Discover');
  });

  it("recognises Mastercard's newer 2221-2720 range", () => {
    // Missed by the naive /^5[1-5]/ rule, and increasingly common.
    expect(detectBrand(MC_NEW_RANGE).brand).toBe('Mastercard');
  });

  it('knows Amex asks for a four-digit code', () => {
    expect(detectBrand(AMEX).cvv).toBe(4);
    expect(detectBrand(VISA).cvv).toBe(3);
  });

  it('returns null rather than guessing', () => {
    expect(detectBrand('9999999999999999')).toBeNull();
    expect(detectBrand('')).toBeNull();
    expect(detectBrand(null)).toBeNull();
  });
});

describe('passesLuhn', () => {
  it('accepts real test numbers', () => {
    for (const number of [VISA, MASTERCARD, AMEX, DISCOVER, MC_NEW_RANGE]) {
      expect(passesLuhn(number), number).toBe(true);
    }
  });

  it('catches a single mistyped digit', () => {
    expect(passesLuhn('4111111111111112')).toBe(false);
  });

  it('catches a transposition', () => {
    // The commonest typing error, and the one Luhn exists for.
    expect(passesLuhn('4111111111111611')).toBe(false);
  });

  it('rejects something too short to be a card', () => {
    expect(passesLuhn('4111')).toBe(false);
    expect(passesLuhn('')).toBe(false);
  });
});

describe('formatNumber', () => {
  it('groups in fours', () => {
    expect(formatNumber(VISA)).toBe('4111 1111 1111 1111');
  });

  it('groups Amex 4-6-5, as it is printed', () => {
    // Regrouping into fours makes it harder to check against the card in
    // your hand, which is the only reason to format it at all.
    expect(formatNumber(AMEX)).toBe('3782 822463 10005');
  });
});

describe('maskNumber', () => {
  it('shows the last four, as a statement does', () => {
    expect(maskNumber(VISA)).toBe('•••• 1111');
  });

  it('reveals nothing from a number too short to mask', () => {
    expect(maskNumber('41')).toBe('••••');
  });
});

describe('isExpired', () => {
  const at = (year, month, day = 15) => new Date(year, month - 1, day).getTime();

  it('treats a card as valid through the end of its expiry month', () => {
    // The fencepost that matters: calling a card dead on the first of its
    // expiry month writes off up to thirty days of a perfectly good card.
    expect(isExpired(6, 2026, at(2026, 6, 1))).toBe(false);
    expect(isExpired(6, 2026, at(2026, 6, 30))).toBe(false);
    expect(isExpired(6, 2026, at(2026, 7, 1))).toBe(true);
  });

  it('returns null when it cannot tell', () => {
    for (const [m, y] of [
      ['', ''],
      [13, 2026],
      [0, 2026],
      ['x', 'y'],
      [6, 26],
    ]) {
      expect(isExpired(m, y), `${m}/${y}`).toBeNull();
    }
  });
});

describe('describeCard', () => {
  it('summarises a good card', () => {
    const described = describeCard({ number: VISA, expiryMonth: 12, expiryYear: 2099 });
    expect(described.brand).toBe('Visa');
    expect(described.masked).toBe('•••• 1111');
    expect(described.valid).toBe(true);
    expect(described.expired).toBe(false);
  });

  it('says nothing at all about an empty number', () => {
    // Warning while somebody is still typing is noise they learn to ignore.
    const described = describeCard({ number: '' });
    expect(described.valid).toBeNull();
    expect(described.lengthLooksWrong).toBeNull();
  });

  it('flags a number of the wrong length for its issuer', () => {
    expect(describeCard({ number: '411111111111' }).lengthLooksWrong).toBe(true);
  });

  it('never carries the full number in its output', () => {
    expect(JSON.stringify(describeCard({ number: VISA }))).not.toContain(VISA);
  });

  it('does not throw on a missing card', () => {
    expect(() => describeCard(null)).not.toThrow();
    expect(() => describeCard({})).not.toThrow();
  });
});
