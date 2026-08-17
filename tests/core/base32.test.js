import { describe, it, expect } from 'vitest';
import { base32Encode, base32Decode } from '../../src/core/base32.js';
import { utf8Encode, utf8Decode } from '../../src/core/encoding.js';
import { ParseError } from '../../src/core/errors.js';

describe('base32Encode', () => {
  it('matches the RFC 4648 test vectors', () => {
    const vectors = [
      ['', ''],
      ['f', 'MY======'],
      ['fo', 'MZXQ===='],
      ['foo', 'MZXW6==='],
      ['foob', 'MZXW6YQ='],
      ['fooba', 'MZXW6YTB'],
      ['foobar', 'MZXW6YTBOI======'],
    ];
    for (const [input, expected] of vectors) {
      expect(base32Encode(utf8Encode(input))).toBe(expected);
    }
  });

  it('encodes the RFC 6238 SHA-1 seed', () => {
    expect(base32Encode(utf8Encode('12345678901234567890'))).toBe(
      'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
    );
  });
});

describe('base32Decode', () => {
  it('matches the RFC 4648 test vectors in reverse', () => {
    const vectors = [
      ['MY======', 'f'],
      ['MZXQ====', 'fo'],
      ['MZXW6===', 'foo'],
      ['MZXW6YQ=', 'foob'],
      ['MZXW6YTB', 'fooba'],
      ['MZXW6YTBOI======', 'foobar'],
    ];
    for (const [input, expected] of vectors) {
      expect(utf8Decode(base32Decode(input))).toBe(expected);
    }
  });

  it('returns empty for empty input', () => {
    expect(base32Decode('').length).toBe(0);
    expect(base32Decode('======').length).toBe(0);
  });

  it('tolerates missing padding', () => {
    expect(utf8Decode(base32Decode('MZXW6YTBOI'))).toBe('foobar');
  });

  it('tolerates lowercase', () => {
    expect(utf8Decode(base32Decode('mzxw6ytboi'))).toBe('foobar');
  });

  it('tolerates the spaces users paste from authenticator setup pages', () => {
    // Services display secrets in space-separated groups; users paste what
    // they see. Rejecting that would be a bug, not strictness.
    expect(utf8Decode(base32Decode('MZXW 6YTB OI'))).toBe('foobar');
    expect(utf8Decode(base32Decode('  mzxw6ytb oi  '))).toBe('foobar');
    expect(utf8Decode(base32Decode('MZXW-6YTB-OI'))).toBe('foobar');
  });

  it('throws ParseError on characters outside the alphabet', () => {
    // 0, 1, 8, and 9 are excluded from RFC 4648 base32.
    expect(() => base32Decode('MZXW0YTB')).toThrow(ParseError);
    expect(() => base32Decode('MZXW1YTB')).toThrow(ParseError);
    expect(() => base32Decode('MZXW8YTB')).toThrow(ParseError);
    expect(() => base32Decode('MZXW9YTB')).toThrow(ParseError);
    expect(() => base32Decode('MZXW!YTB')).toThrow(ParseError);
  });

  it('throws ParseError on an impossible length', () => {
    // 1, 3, and 6 leftover characters carry fewer than 8 whole bits.
    expect(() => base32Decode('M')).toThrow(ParseError);
    expect(() => base32Decode('MZX')).toThrow(ParseError);
    expect(() => base32Decode('MZXW6Y')).toThrow(ParseError);
  });

  it('throws ParseError on non-string input', () => {
    expect(() => base32Decode(null)).toThrow(ParseError);
    expect(() => base32Decode(12345)).toThrow(ParseError);
  });

  it('round-trips arbitrary byte arrays of every length remainder', () => {
    for (let len = 0; len < 40; len += 1) {
      const bytes = new Uint8Array(len).map((_, i) => (i * 37 + len) % 256);
      expect(Array.from(base32Decode(base32Encode(bytes)))).toEqual(Array.from(bytes));
    }
  });
});
