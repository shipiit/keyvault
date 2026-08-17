import { describe, it, expect } from 'vitest';
import { generateTotp, totpTimeRemaining, DEFAULT_TOTP } from '../../src/core/totp.js';
import { base32Encode } from '../../src/core/base32.js';
import { utf8Encode } from '../../src/core/encoding.js';

// RFC 6238 Appendix B seeds. Each algorithm uses a seed truncated or
// repeated to its own key length.
const SEED_SHA1 = base32Encode(utf8Encode('12345678901234567890'));
const SEED_SHA256 = base32Encode(utf8Encode('12345678901234567890123456789012'));
const SEED_SHA512 = base32Encode(
  utf8Encode('1234567890123456789012345678901234567890123456789012345678901234'),
);

describe('generateTotp — RFC 6238 known-answer vectors', () => {
  const cases = [
    [59, 'SHA-1', SEED_SHA1, '94287082'],
    [1111111109, 'SHA-1', SEED_SHA1, '07081804'],
    [1111111111, 'SHA-1', SEED_SHA1, '14050471'],
    [1234567890, 'SHA-1', SEED_SHA1, '89005924'],
    [2000000000, 'SHA-1', SEED_SHA1, '69279037'],
    // Past the 32-bit boundary: a counter computed with bitwise operators
    // instead of BigInt silently produces the wrong code here.
    [20000000000, 'SHA-1', SEED_SHA1, '65353130'],
    [59, 'SHA-256', SEED_SHA256, '46119246'],
    [1111111109, 'SHA-256', SEED_SHA256, '68084774'],
    [1111111111, 'SHA-256', SEED_SHA256, '67062674'],
    [1234567890, 'SHA-256', SEED_SHA256, '91819424'],
    [2000000000, 'SHA-256', SEED_SHA256, '90698825'],
    [20000000000, 'SHA-256', SEED_SHA256, '77737706'],
    [59, 'SHA-512', SEED_SHA512, '90693936'],
    [1111111109, 'SHA-512', SEED_SHA512, '25091201'],
    [1111111111, 'SHA-512', SEED_SHA512, '99943326'],
    [1234567890, 'SHA-512', SEED_SHA512, '93441116'],
    [2000000000, 'SHA-512', SEED_SHA512, '38618901'],
    [20000000000, 'SHA-512', SEED_SHA512, '47863826'],
  ];

  for (const [seconds, algorithm, secret, expected] of cases) {
    it(`${algorithm} at t=${seconds} produces ${expected}`, async () => {
      const code = await generateTotp({
        secret,
        algorithm,
        digits: 8,
        period: 30,
        timestamp: seconds * 1000,
      });
      expect(code).toBe(expected);
    });
  }
});

describe('generateTotp — behaviour', () => {
  it('defaults to 6 digits, SHA-1, 30-second period', async () => {
    expect(DEFAULT_TOTP).toEqual({ algorithm: 'SHA-1', digits: 6, period: 30 });
    const code = await generateTotp({ secret: SEED_SHA1, timestamp: 59000 });
    expect(code).toBe('287082'); // last 6 of the 8-digit vector
  });

  it('zero-pads short codes', async () => {
    const code = await generateTotp({ secret: SEED_SHA1, timestamp: 1111111109000 });
    expect(code).toBe('081804');
    expect(code).toHaveLength(6);
  });

  it('returns the same code throughout one period', async () => {
    const a = await generateTotp({ secret: SEED_SHA1, timestamp: 60000 });
    const b = await generateTotp({ secret: SEED_SHA1, timestamp: 89999 });
    expect(a).toBe(b);
  });

  it('changes at the period boundary', async () => {
    const a = await generateTotp({ secret: SEED_SHA1, timestamp: 89999 });
    const b = await generateTotp({ secret: SEED_SHA1, timestamp: 90000 });
    expect(a).not.toBe(b);
  });

  it('honours a custom period', async () => {
    const a = await generateTotp({ secret: SEED_SHA1, period: 60, timestamp: 0 });
    const b = await generateTotp({ secret: SEED_SHA1, period: 60, timestamp: 59999 });
    const c = await generateTotp({ secret: SEED_SHA1, period: 60, timestamp: 60000 });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('accepts a secret with the whitespace users paste', async () => {
    const spaced = SEED_SHA1.replace(/(.{4})/g, '$1 ');
    expect(await generateTotp({ secret: spaced, timestamp: 59000 })).toBe('287082');
  });

  it('rejects an unsupported digit count', async () => {
    await expect(generateTotp({ secret: SEED_SHA1, digits: 5 })).rejects.toThrow(RangeError);
    await expect(generateTotp({ secret: SEED_SHA1, digits: 9 })).rejects.toThrow(RangeError);
  });

  it('rejects an unsupported algorithm', async () => {
    await expect(generateTotp({ secret: SEED_SHA1, algorithm: 'MD5' })).rejects.toThrow(RangeError);
  });

  it('rejects a non-positive period', async () => {
    await expect(generateTotp({ secret: SEED_SHA1, period: 0 })).rejects.toThrow(RangeError);
    await expect(generateTotp({ secret: SEED_SHA1, period: -30 })).rejects.toThrow(RangeError);
  });
});

describe('totpTimeRemaining', () => {
  it('counts down within the period', () => {
    expect(totpTimeRemaining(30, 0)).toBe(30);
    expect(totpTimeRemaining(30, 1000)).toBe(29);
    expect(totpTimeRemaining(30, 29000)).toBe(1);
    expect(totpTimeRemaining(30, 30000)).toBe(30);
  });

  it('honours a custom period', () => {
    expect(totpTimeRemaining(60, 1000)).toBe(59);
  });

  it('defaults to the standard 30-second period', () => {
    expect(totpTimeRemaining(undefined, 1000)).toBe(29);
  });
});
