import { describe, it, expect } from 'vitest';
import {
  utf8Encode,
  utf8Decode,
  toBase64,
  fromBase64,
  toBase64Url,
  fromBase64Url,
  toHex,
  concatBytes,
  bytesEqual,
} from '../../src/core/encoding.js';
import { ParseError } from '../../src/core/errors.js';

describe('utf8', () => {
  it('round-trips ASCII', () => {
    expect(utf8Decode(utf8Encode('hello'))).toBe('hello');
  });

  it('round-trips multi-byte characters', () => {
    const s = 'pässwörd — 密码 🔐';
    expect(utf8Decode(utf8Encode(s))).toBe(s);
  });

  it('encodes to the documented byte length', () => {
    expect(utf8Encode('a').length).toBe(1);
    expect(utf8Encode('é').length).toBe(2);
    expect(utf8Encode('🔐').length).toBe(4);
  });
});

describe('base64', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255, 42]);
    expect(Array.from(fromBase64(toBase64(bytes)))).toEqual(Array.from(bytes));
  });

  it('produces the standard encoding for a known input', () => {
    expect(toBase64(utf8Encode('hello'))).toBe('aGVsbG8=');
    expect(utf8Decode(fromBase64('aGVsbG8='))).toBe('hello');
  });

  it('handles the empty array', () => {
    expect(toBase64(new Uint8Array())).toBe('');
    expect(fromBase64('').length).toBe(0);
  });

  it('round-trips a payload larger than the chunking threshold', () => {
    const bytes = new Uint8Array(100000).map((_, i) => i % 256);
    expect(Array.from(fromBase64(toBase64(bytes)))).toEqual(Array.from(bytes));
  });

  it('throws ParseError on invalid base64', () => {
    expect(() => fromBase64('not!valid!')).toThrow(ParseError);
  });
});

describe('base64url', () => {
  it('uses the URL-safe alphabet and strips padding', () => {
    const bytes = new Uint8Array([251, 255, 190]);
    const encoded = toBase64Url(bytes);
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('=');
    expect(Array.from(fromBase64Url(encoded))).toEqual(Array.from(bytes));
  });

  it('round-trips every remainder case', () => {
    for (let len = 0; len < 8; len += 1) {
      const bytes = new Uint8Array(len).map((_, i) => (i * 91) % 256);
      expect(Array.from(fromBase64Url(toBase64Url(bytes)))).toEqual(Array.from(bytes));
    }
  });
});

describe('toHex', () => {
  it('zero-pads each byte to two characters', () => {
    expect(toHex(new Uint8Array([0, 15, 16, 255]))).toBe('000f10ff');
  });
});

describe('concatBytes', () => {
  it('joins in order', () => {
    const r = concatBytes(new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([]));
    expect(Array.from(r)).toEqual([1, 2, 3]);
  });

  it('returns an empty array for no arguments', () => {
    expect(concatBytes().length).toBe(0);
  });
});

describe('bytesEqual', () => {
  it('compares by content', () => {
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
  });

  it('returns false for different lengths', () => {
    expect(bytesEqual(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
  });

  it('detects a difference in the first byte as well as the last', () => {
    expect(bytesEqual(new Uint8Array([9, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(false);
    expect(bytesEqual(new Uint8Array([1, 2, 9]), new Uint8Array([1, 2, 3]))).toBe(false);
  });

  it('treats empty arrays as equal', () => {
    expect(bytesEqual(new Uint8Array(), new Uint8Array())).toBe(true);
  });
});
