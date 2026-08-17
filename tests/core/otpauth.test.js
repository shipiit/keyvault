import { describe, it, expect } from 'vitest';
import { parseOtpauthUri, buildOtpauthUri } from '../../src/core/totp.js';
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
    expect(() => parseOtpauthUri('https://example.com?secret=JBSWY3DPEHPK3PXP')).toThrow(ParseError);
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
    expect(() => parseOtpauthUri('otpauth://totp/GitHub:a@b.com?issuer=GitHub')).toThrow(ParseError);
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
