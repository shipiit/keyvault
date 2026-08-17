import { base32Decode } from './base32.js';
import { ParseError } from './errors.js';

/** RFC 6238 defaults, and what essentially every service provisions. */
export const DEFAULT_TOTP = Object.freeze({
  algorithm: 'SHA-1',
  digits: 6,
  period: 30,
});

const SUPPORTED_ALGORITHMS = new Set(['SHA-1', 'SHA-256', 'SHA-512']);
const SUPPORTED_DIGITS = new Set([6, 7, 8]);

/**
 * Shortest bare setup key accepted.
 *
 * RFC 4226 requires at least 80 bits of shared secret, which is 16 base32
 * characters. The floor matters because A–Z are all valid base32, so
 * without it any pasted word would be stored as a working-looking key.
 */
const MIN_BARE_SECRET_LENGTH = 16;

const ALGORITHM_ALIASES = new Map([
  ['SHA1', 'SHA-1'],
  ['SHA-1', 'SHA-1'],
  ['SHA256', 'SHA-256'],
  ['SHA-256', 'SHA-256'],
  ['SHA512', 'SHA-512'],
  ['SHA-512', 'SHA-512'],
]);

/**
 * Generate a TOTP code (RFC 6238).
 *
 * SHA-1 remains the default because it is what virtually every service
 * provisions. Its use here is inside HMAC, where the collision weaknesses
 * that retired SHA-1 for signatures do not apply.
 *
 * @param {object} options
 * @param {string} options.secret base32-encoded shared secret
 * @param {'SHA-1'|'SHA-256'|'SHA-512'} [options.algorithm]
 * @param {number} [options.digits]
 * @param {number} [options.period] seconds
 * @param {number} [options.timestamp] milliseconds since epoch
 * @returns {Promise<string>} zero-padded code
 */
export async function generateTotp({
  secret,
  algorithm = DEFAULT_TOTP.algorithm,
  digits = DEFAULT_TOTP.digits,
  period = DEFAULT_TOTP.period,
  timestamp = Date.now(),
} = {}) {
  if (!SUPPORTED_ALGORITHMS.has(algorithm)) {
    throw new RangeError(`unsupported TOTP algorithm: ${algorithm}`);
  }
  if (!SUPPORTED_DIGITS.has(digits)) {
    throw new RangeError(`unsupported TOTP digit count: ${digits}`);
  }
  if (!Number.isFinite(period) || period <= 0) {
    throw new RangeError('TOTP period must be a positive number of seconds');
  }

  const counter = BigInt(Math.floor(timestamp / 1000 / period));
  const key = await crypto.subtle.importKey(
    'raw',
    // Lenient: a TOTP secret is a run of base32 characters, not a canonical
    // RFC 4648 encoding, and services issue lengths the strict rule rejects.
    base32Decode(secret, { lenient: true }),
    { name: 'HMAC', hash: { name: algorithm } },
    false,
    ['sign'],
  );
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterToBytes(counter)));

  // RFC 4226 dynamic truncation: the low nibble of the final byte selects a
  // 4-byte window, whose top bit is masked off to keep the value positive.
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 10 ** digits).padStart(digits, '0');
}

/**
 * Seconds until the current code expires.
 *
 * @param {number} [period]
 * @param {number} [timestamp] milliseconds since epoch
 * @returns {number}
 */
export function totpTimeRemaining(period = DEFAULT_TOTP.period, timestamp = Date.now()) {
  const seconds = Math.floor(timestamp / 1000);
  return period - (seconds % period);
}

/**
 * The RFC 4226 counter as a big-endian 8-byte block.
 *
 * BigInt rather than bitwise arithmetic: past 2^31 seconds the counter
 * exceeds what a 32-bit shift can hold, and the failure is silent — wrong
 * codes, no error. RFC 6238's t=20000000000 vector exists to catch exactly
 * this and is in the test suite.
 *
 * @param {bigint} counter
 * @returns {Uint8Array}
 */
function counterToBytes(counter) {
  const out = new Uint8Array(8);
  let remaining = counter;
  for (let i = 7; i >= 0; i -= 1) {
    out[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return out;
}

/**
 * Parse an `otpauth://totp/...` URI — the Key URI Format behind every
 * authenticator QR code.
 *
 * The secret is validated as real base32 here rather than lazily at
 * code-generation time, so a malformed QR fails while the user is still
 * looking at it, not at 3am when they need to log in.
 *
 * @param {string} uri
 * @returns {{type: string, issuer: string, account: string, secret: string,
 *            algorithm: string, digits: number, period: number}}
 */
export function parseOtpauthUri(uri) {
  if (typeof uri !== 'string' || !uri.toLowerCase().startsWith('otpauth://')) {
    throw new ParseError('not an otpauth:// URI');
  }

  let url;
  try {
    url = new URL(uri);
  } catch (cause) {
    throw new ParseError('malformed otpauth:// URI', { cause });
  }

  const type = url.host.toLowerCase();
  if (type !== 'totp') {
    throw new ParseError(`unsupported OTP type: ${type} (only totp is supported)`);
  }

  // The path is "/Issuer:account" or "/account", percent-encoded.
  const label = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const separator = label.indexOf(':');
  const labelIssuer = separator === -1 ? '' : label.slice(0, separator).trim();
  const account = (separator === -1 ? label : label.slice(separator + 1)).trim();

  const params = url.searchParams;

  const secret = (params.get('secret') ?? '').replace(/\s/g, '').toUpperCase();
  if (secret === '') {
    throw new ParseError('otpauth:// URI has no secret');
  }
  try {
    const decoded = base32Decode(secret, { lenient: true });
    if (decoded.length === 0) {
      throw new ParseError('otpauth:// secret is too short to be a key');
    }
  } catch (cause) {
    if (cause instanceof ParseError) {
      throw cause;
    }
    throw new ParseError('otpauth:// secret is not valid base32', { cause });
  }

  const rawAlgorithm = (params.get('algorithm') ?? 'SHA1').toUpperCase();
  const algorithm = ALGORITHM_ALIASES.get(rawAlgorithm);
  if (algorithm === undefined) {
    throw new ParseError(`unsupported TOTP algorithm: ${rawAlgorithm}`);
  }

  const digits = parseIntegerParam(params.get('digits'), DEFAULT_TOTP.digits, 'digits');
  if (!SUPPORTED_DIGITS.has(digits)) {
    throw new ParseError(`unsupported TOTP digit count: ${digits}`);
  }

  const period = parseIntegerParam(params.get('period'), DEFAULT_TOTP.period, 'period');
  if (period <= 0) {
    throw new ParseError('TOTP period must be positive');
  }

  return {
    type: 'totp',
    issuer: params.get('issuer')?.trim() || labelIssuer,
    account,
    secret,
    algorithm,
    digits,
    period,
  };
}

/**
 * Parse whatever a user pastes into a two-factor field.
 *
 * Sites hand out the secret in two shapes — a full `otpauth://` URI, or the
 * bare setup key printed beside the QR — and users paste whichever they were
 * given. Accepting only one of them makes a perfectly valid key look
 * invalid.
 *
 * This exists because the edit form and the setup card each did their own
 * validation and drifted: one accepted a bare key, the other rejected it.
 * One function, used by both, cannot disagree with itself.
 *
 * @param {string} input
 * @param {{title?: string}} [context] names the account when only a bare key
 *   was given, since a bare key carries no label
 * @returns {{type: string, issuer: string, account: string, secret: string,
 *            algorithm: string, digits: number, period: number}}
 */
export function parseTotpInput(input, context = {}) {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new ParseError('enter a setup key or an otpauth:// link');
  }

  const raw = input.trim();
  if (raw.toLowerCase().startsWith('otpauth')) {
    return parseOtpauthUri(raw);
  }

  // Every letter A–Z is a base32 character, so an ordinary English word
  // decodes happily and would be stored as a secret that never produces a
  // working code. RFC 4226 puts the floor at 80 bits — 16 characters — and
  // no real service issues less, so anything shorter is a mis-paste.
  const compact = raw.replace(/[\s-]/g, '');
  if (compact.length < MIN_BARE_SECRET_LENGTH) {
    throw new ParseError(
      `a setup key is at least ${MIN_BARE_SECRET_LENGTH} characters — check what you pasted`,
    );
  }

  const label = context.title ?? 'Account';
  return parseOtpauthUri(
    `otpauth://totp/${encodeURIComponent(label)}?secret=${encodeURIComponent(raw)}`,
  );
}

/**
 * Build an `otpauth://` URI, for encrypted export and for the "show QR"
 * flow that moves a credential to another device.
 *
 * @param {{issuer?: string, account?: string, secret: string,
 *          algorithm?: string, digits?: number, period?: number}} config
 * @returns {string}
 */
export function buildOtpauthUri({
  issuer = '',
  account = '',
  secret,
  algorithm = DEFAULT_TOTP.algorithm,
  digits = DEFAULT_TOTP.digits,
  period = DEFAULT_TOTP.period,
}) {
  const label = issuer === '' ? account : `${issuer}:${account}`;
  const params = new URLSearchParams({ secret });
  if (issuer !== '') {
    params.set('issuer', issuer);
  }
  if (algorithm !== DEFAULT_TOTP.algorithm) {
    params.set('algorithm', algorithm.replace('-', ''));
  }
  if (digits !== DEFAULT_TOTP.digits) {
    params.set('digits', String(digits));
  }
  if (period !== DEFAULT_TOTP.period) {
    params.set('period', String(period));
  }
  // encodeURIComponent escapes ':', which the label format wants literal;
  // it is restored rather than left encoded so other apps parse the label.
  return `otpauth://totp/${encodeURIComponent(label).replace(/%3A/gi, ':')}?${params.toString()}`;
}

/**
 * @param {string|null} raw
 * @param {number} fallback
 * @param {string} name
 * @returns {number}
 */
function parseIntegerParam(raw, fallback, name) {
  if (raw === null || raw === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new ParseError(`otpauth:// ${name} must be an integer`);
  }
  return value;
}
