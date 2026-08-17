import { ParseError } from './errors.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: false });

/**
 * @param {string} str
 * @returns {Uint8Array}
 */
export function utf8Encode(str) {
  return encoder.encode(str);
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function utf8Decode(bytes) {
  return decoder.decode(bytes);
}

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function toBase64(bytes) {
  let binary = '';
  // Chunked because String.fromCharCode is applied via spread, and a whole
  // vault passed as one argument list would exceed the engine's limit.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * @param {string} str
 * @returns {Uint8Array}
 */
export function fromBase64(str) {
  if (typeof str !== 'string' || !BASE64_RE.test(str)) {
    throw new ParseError('invalid base64 input');
  }
  let binary;
  try {
    binary = atob(str);
  } catch (cause) {
    throw new ParseError('invalid base64 input', { cause });
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function toBase64Url(bytes) {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * @param {string} str
 * @returns {Uint8Array}
 */
export function fromBase64Url(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const remainder = padded.length % 4;
  return fromBase64(remainder === 0 ? padded : padded + '='.repeat(4 - remainder));
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function toHex(bytes) {
  let out = '';
  for (const b of bytes) {
    out += b.toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * @param {...Uint8Array} parts
 * @returns {Uint8Array}
 */
export function concatBytes(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
