import { describe, it, expect } from 'vitest';
import { parseOtpauthUri, buildOtpauthUri, parseTotpInput } from '../../src/core/totp.js';
import { ParseError } from '../../src/core/errors.js';

describe('parseOtpauthUri', () => {
  it('parses a typical Google Authenticator URI', () => {
    const r = parseOtpauthUri(
      'otpauth://totp/GitHub:rahul@example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub',
    );
    expect(r).toEqual({
      type: 'totp',
      issuer: 'GitHub',
      account: 'rahul@example.com',
      secret: 'JBSWY3DPEHPK3PXP',
      algorithm: 'SHA-1',
      digits: 6,
      period: 30,
    });
  });

  it('reads issuer from the label when the parameter is absent', () => {
    const r = parseOtpauthUri('otpauth://totp/ACME%20Co:john@acme.com?secret=JBSWY3DPEHPK3PXP');
    expect(r.issuer).toBe('ACME Co');
    expect(r.account).toBe('john@acme.com');
  });

  it('prefers the issuer parameter over the label prefix', () => {
    const r = parseOtpauthUri('otpauth://totp/Wrong:a@b.com?secret=JBSWY3DPEHPK3PXP&issuer=Right');
    expect(r.issuer).toBe('Right');
  });

  it('handles a label with no issuer prefix', () => {
    const r = parseOtpauthUri('otpauth://totp/alice@example.com?secret=JBSWY3DPEHPK3PXP');
    expect(r.issuer).toBe('');
    expect(r.account).toBe('alice@example.com');
  });

  it('normalises algorithm names to WebCrypto form', () => {
    const at = (a) =>
      parseOtpauthUri(`otpauth://totp/a?secret=JBSWY3DPEHPK3PXP&algorithm=${a}`).algorithm;
    expect(at('SHA1')).toBe('SHA-1');
    expect(at('sha256')).toBe('SHA-256');
    expect(at('SHA-512')).toBe('SHA-512');
  });

  it('parses custom digits and period', () => {
    const r = parseOtpauthUri('otpauth://totp/a?secret=JBSWY3DPEHPK3PXP&digits=8&period=60');
    expect(r.digits).toBe(8);
    expect(r.period).toBe(60);
  });

  it('strips whitespace from the secret', () => {
    expect(parseOtpauthUri('otpauth://totp/a?secret=JBSW%20Y3DP%20EHPK3PXP').secret).toBe(
      'JBSWY3DPEHPK3PXP',
    );
  });

  it('uppercases a lowercase secret', () => {
    expect(parseOtpauthUri('otpauth://totp/a?secret=jbswy3dpehpk3pxp').secret).toBe(
      'JBSWY3DPEHPK3PXP',
    );
  });

  it('rejects a non-otpauth scheme', () => {
    expect(() => parseOtpauthUri('https://example.com?secret=JBSWY3DPEHPK3PXP')).toThrow(
      ParseError,
    );
  });

  it('rejects hotp, which this version does not support', () => {
    expect(() => parseOtpauthUri('otpauth://hotp/a?secret=JBSWY3DPEHPK3PXP&counter=1')).toThrow(
      ParseError,
    );
  });

  it('rejects the Google Authenticator bulk-export format', () => {
    // otpauth-migration:// carries a protobuf payload, not a single secret.
    // Out of scope for v1; it must fail loudly rather than half-parse.
    expect(() => parseOtpauthUri('otpauth-migration://offline?data=CjEKCkhlbGxv')).toThrow(
      ParseError,
    );
  });

  it('rejects a missing secret', () => {
    expect(() => parseOtpauthUri('otpauth://totp/GitHub:a@b.com?issuer=GitHub')).toThrow(
      ParseError,
    );
  });

  it('rejects a secret that is not valid base32', () => {
    expect(() => parseOtpauthUri('otpauth://totp/a?secret=NOT!BASE32')).toThrow(ParseError);
    expect(() => parseOtpauthUri('otpauth://totp/a?secret=AAAA0AAA')).toThrow(ParseError);
  });

  it('rejects an unsupported algorithm', () => {
    expect(() => parseOtpauthUri('otpauth://totp/a?secret=JBSWY3DPEHPK3PXP&algorithm=MD5')).toThrow(
      ParseError,
    );
  });

  it('rejects an unsupported digit count', () => {
    expect(() => parseOtpauthUri('otpauth://totp/a?secret=JBSWY3DPEHPK3PXP&digits=5')).toThrow(
      ParseError,
    );
  });

  it('rejects a non-integer or non-positive period', () => {
    expect(() => parseOtpauthUri('otpauth://totp/a?secret=JBSWY3DPEHPK3PXP&period=abc')).toThrow(
      ParseError,
    );
    expect(() => parseOtpauthUri('otpauth://totp/a?secret=JBSWY3DPEHPK3PXP&period=0')).toThrow(
      ParseError,
    );
  });

  it('rejects garbage input', () => {
    expect(() => parseOtpauthUri('not a uri at all')).toThrow(ParseError);
    expect(() => parseOtpauthUri('')).toThrow(ParseError);
    expect(() => parseOtpauthUri(null)).toThrow(ParseError);
  });
});

describe('parseTotpInput — whatever the user pastes', () => {
  // Sites hand out the secret in two shapes and users paste whichever they
  // were given. Accepting only one makes a valid key look invalid, which is
  // exactly what the edit form used to do while the setup card accepted it.
  const SECRET = 'K5XQ7ZTM2WFB4HRJ6NPD3SVA5YCE7GLU';

  it('accepts a bare setup key', () => {
    expect(parseTotpInput(SECRET).secret).toBe(SECRET);
  });

  it('accepts a full otpauth link', () => {
    expect(parseTotpInput(`otpauth://totp/A?secret=${SECRET}`).secret).toBe(SECRET);
  });

  it('accepts a key printed in space-separated groups', () => {
    expect(parseTotpInput('K5XQ 7ZTM 2WFB 4HRJ 6NPD 3SVA 5YCE 7GLU').secret).toBe(SECRET);
  });

  it('accepts lowercase, which sites and users both produce', () => {
    expect(parseTotpInput(SECRET.toLowerCase()).secret).toBe(SECRET);
  });

  it('tolerates a trailing newline from a copy', () => {
    expect(parseTotpInput(`${SECRET}\n`).secret).toBe(SECRET);
  });

  it('names the account from the item when only a bare key was given', () => {
    // A bare key carries no label, so without this every such entry would
    // be filed under the same placeholder.
    expect(parseTotpInput(SECRET, { title: 'DRK CACHE' }).account).toBe('DRK CACHE');
  });

  it('keeps the label from a full link over the item title', () => {
    const parsed = parseTotpInput(`otpauth://totp/Site:me@x.com?secret=${SECRET}`, {
      title: 'Ignored',
    });
    expect(parsed.account).toBe('me@x.com');
    expect(parsed.issuer).toBe('Site');
  });

  it('rejects a pasted word, which is otherwise valid base32', () => {
    // Every letter A-Z is a base32 character, so an English word decodes
    // happily and would be stored as a key that never produces a code.
    expect(() => parseTotpInput('hello there')).toThrow(/at least 16 characters/);
    expect(() => parseTotpInput('password')).toThrow(ParseError);
  });

  it('rejects empty and non-string input', () => {
    expect(() => parseTotpInput('')).toThrow(ParseError);
    expect(() => parseTotpInput(null)).toThrow(ParseError);
  });
});

describe('base32 lengths services actually issue', () => {
  // A canonical RFC 4648 encoding never leaves 1, 3 or 6 characters over,
  // but TOTP secrets are not canonical encodings — they are a run of base32
  // characters, and services do issue these lengths. Rejecting them made
  // KeyVault the only tool that could not read the key.
  for (const length of [16, 20, 26, 27, 30, 32, 33]) {
    it(`accepts a ${length}-character key`, () => {
      const secret = 'K5XQ7ZTM2WFB4HRJ6NPD3SVA5YCE7GLUMPSM'.slice(0, length);
      expect(parseTotpInput(secret).secret).toBe(secret);
    });
  }

  it('rejects a key below the RFC 4226 minimum of 80 bits', () => {
    expect(() => parseTotpInput('A')).toThrow(ParseError);
    expect(() => parseTotpInput('K5XQ7ZTM2WFB4HR')).toThrow(ParseError);
  });
});

describe('buildOtpauthUri', () => {
  it('round-trips through the parser', () => {
    const config = {
      issuer: 'GitHub',
      account: 'rahul@example.com',
      secret: 'JBSWY3DPEHPK3PXP',
      algorithm: 'SHA-256',
      digits: 8,
      period: 60,
    };
    expect(parseOtpauthUri(buildOtpauthUri(config))).toEqual({ type: 'totp', ...config });
  });

  it('percent-encodes issuer and account', () => {
    const uri = buildOtpauthUri({
      issuer: 'ACME Co',
      account: 'a b@c.com',
      secret: 'JBSWY3DPEHPK3PXP',
    });
    expect(uri).toContain('ACME%20Co');
    expect(parseOtpauthUri(uri).account).toBe('a b@c.com');
  });

  it('omits parameters that match the defaults', () => {
    const uri = buildOtpauthUri({ issuer: 'X', account: 'y', secret: 'JBSWY3DPEHPK3PXP' });
    expect(uri).not.toContain('digits=');
    expect(uri).not.toContain('period=');
    expect(uri).not.toContain('algorithm=');
  });

  it('round-trips an entry with no issuer', () => {
    const uri = buildOtpauthUri({ account: 'solo@example.com', secret: 'JBSWY3DPEHPK3PXP' });
    const parsed = parseOtpauthUri(uri);
    expect(parsed.issuer).toBe('');
    expect(parsed.account).toBe('solo@example.com');
  });
});
