import { ParseError } from './errors.js';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const DECODE_MAP = (() => {
  const map = new Map();
  for (let i = 0; i < ALPHABET.length; i += 1) {
    map.set(ALPHABET[i], i);
  }
  return map;
})();

/**
 * RFC 4648 base32 encode, with padding.
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function base32Encode(bytes) {
  let out = '';
  let buffer = 0;
  let bits = 0;

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(buffer >> bits) & 0x1f];
    }
  }
  if (bits > 0) {
    // Left-align the remaining bits within a 5-bit group.
    out += ALPHABET[(buffer << (5 - bits)) & 0x1f];
  }
  while (out.length % 8 !== 0) {
    out += '=';
  }
  return out;
}

/**
 * RFC 4648 base32 decode.
 *
 * Deliberately permissive about presentation and strict about content:
 * padding is optional, case is ignored, and whitespace and hyphens are
 * stripped — authenticator setup pages display secrets in space-separated
 * groups and users paste them verbatim. Any character outside the alphabet
 * is still an error.
 *
 * @param {string} input
 * @returns {Uint8Array}
 */
export function base32Decode(input) {
  if (typeof input !== 'string') {
    throw new ParseError('base32 input must be a string');
  }

  const cleaned = input.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
  if (cleaned.length === 0) {
    return new Uint8Array();
  }
  // 1, 3, and 6 leftover characters carry fewer than 8 whole bits, so they
  // cannot terminate a valid encoding.
  if ([1, 3, 6].includes(cleaned.length % 8)) {
    throw new ParseError('base32 input has an invalid length');
  }

  const out = new Uint8Array(Math.floor((cleaned.length * 5) / 8));
  let buffer = 0;
  let bits = 0;
  let index = 0;

  for (const char of cleaned) {
    const value = DECODE_MAP.get(char);
    if (value === undefined) {
      throw new ParseError(`invalid base32 character: ${char}`);
    }
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out[index] = (buffer >> bits) & 0xff;
      index += 1;
    }
  }
  return out;
}
