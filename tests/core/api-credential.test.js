import { describe, it, expect } from 'vitest';
/**
 * The fixtures below carry hyphens on purpose. A realistic-looking
 * `sk_live_` followed by 32 alphanumerics is exactly what GitHub's push
 * protection matches as a Stripe key — it blocked this very commit until the
 * fixture was changed. The hyphens put it outside that charset while keeping
 * the prefix the detector needs, so please do not "tidy" it back.
 */
import {
  detectProvider,
  looksLikeProduction,
  maskCredential,
  expiryStatus,
  describeCredential,
  CREDENTIAL_TYPES,
  ENVIRONMENTS,
  EXPIRING_SOON_DAYS,
} from '../../src/core/api-credential.js';

const NOW = 1_700_000_000_000;
const DAY = 86400000;

describe('detectProvider', () => {
  it('names the issuer from its documented prefix', () => {
    expect(detectProvider('ghp_abcdefghijklmnop')).toMatchObject({ provider: 'GitHub' });
    expect(detectProvider('AKIAIOSFODNN7EXAMPLE')).toMatchObject({ provider: 'AWS' });
    expect(detectProvider('xoxb-123-456-abc')).toMatchObject({ provider: 'Slack' });
    expect(detectProvider('glpat-abcdefghij')).toMatchObject({ provider: 'GitLab' });
  });

  it('distinguishes a live key from a test key of the same issuer', () => {
    // The single most consequential thing the prefix tells you.
    expect(detectProvider('sk_live_abc').live).toBe(true);
    expect(detectProvider('sk_test_abc').live).toBe(false);
  });

  it('prefers the longer prefix when two issuers overlap', () => {
    // sk- is a prefix of sk-ant-. Matching the short one first would file
    // every Anthropic key under OpenAI.
    expect(detectProvider('sk-ant-api03-xyz').provider).toBe('Anthropic');
    expect(detectProvider('sk-proj-xyz').provider).toBe('OpenAI');
    expect(detectProvider('github_pat_11ABC').kind).toMatch(/fine-grained/i);
  });

  it('says nothing about production for an issuer whose prefix does not encode it', () => {
    // A tri-state, not a boolean: null means "the prefix does not say", and
    // collapsing that to false would mark unknown keys as safe.
    expect(detectProvider('github_pat_11ABC').live).toBeNull();
  });

  it('returns null rather than guessing at an unknown key', () => {
    expect(detectProvider('kv_live_EXAMPLE-not-a-real-key')).toBeNull();
    expect(detectProvider('just-some-string')).toBeNull();
  });

  it('survives anything that is not a string', () => {
    for (const value of [null, undefined, 42, {}, []]) {
      expect(detectProvider(value)).toBeNull();
    }
  });
});

describe('looksLikeProduction', () => {
  it('trusts the issuer prefix when there is one', () => {
    expect(looksLikeProduction('sk_live_abc')).toBe(true);
    expect(looksLikeProduction('sk_test_abc')).toBe(false);
  });

  it('falls back to the naming convention for unknown issuers', () => {
    // The exact case this project met: a key from no known issuer whose own
    // name announced it was live.
    expect(looksLikeProduction('kv_live_EXAMPLE-not-a-real-key')).toBe(true);
    expect(looksLikeProduction('acme-prod-token')).toBe(true);
    expect(looksLikeProduction('acme_production_key')).toBe(true);
  });

  it('does not fire on a word that merely contains "prod" or "live"', () => {
    // "delivery" and "product" would otherwise mark half the vault as
    // production, and a warning that cries wolf gets switched off.
    expect(looksLikeProduction('delivery-service-key')).toBe(false);
    expect(looksLikeProduction('product-catalogue-token')).toBe(false);
  });

  it('is false for an empty or missing value', () => {
    expect(looksLikeProduction('')).toBe(false);
    expect(looksLikeProduction(undefined)).toBe(false);
  });
});

describe('maskCredential', () => {
  it('keeps the issuer prefix and the tail, and hides the middle', () => {
    // The prefix identifies without authenticating; the tail is how you tell
    // two keys from the same issuer apart.
    const masked = maskCredential('sk_live_EXAMPLE-not-a-real-key');
    expect(masked.startsWith('sk_live')).toBe(true);
    expect(masked.endsWith('-key')).toBe(true);
    expect(masked).not.toContain('EXAMPLE-not-a');
  });

  it('reveals nothing at all from a short secret', () => {
    // Below a certain length, showing head and tail shows most of it.
    for (const short of ['abc', 'hunter2', 'sk_live_ab']) {
      expect(maskCredential(short), short).toMatch(/^•+$/);
    }
  });

  it('never returns a stub short enough to imply the secret was short', () => {
    expect(maskCredential('a').length).toBeGreaterThanOrEqual(8);
    expect(maskCredential('')).toBe('••••••••');
  });
});

describe('expiryStatus', () => {
  it('reports an expired credential, with how long ago', () => {
    const s = expiryStatus({ expires: NOW - 5 * DAY }, NOW);
    expect(s.state).toBe('expired');
    expect(s.days).toBeLessThan(0);
  });

  it('warns inside the notice window and not outside it', () => {
    expect(expiryStatus({ expires: NOW + 10 * DAY }, NOW).state).toBe('expiring');
    expect(expiryStatus({ expires: NOW + (EXPIRING_SOON_DAYS + 5) * DAY }, NOW).state).toBe(
      'valid',
    );
  });

  it('treats a credential that is not yet valid as pending, not expired', () => {
    expect(expiryStatus({ validFrom: NOW + 3 * DAY, expires: NOW + 90 * DAY }, NOW).state).toBe(
      'pending',
    );
  });

  it('reports no expiry as "none" rather than as a problem', () => {
    // Plenty of keys never expire. Flagging that trains people to ignore the
    // warning on the ones that do.
    expect(expiryStatus({}, NOW).state).toBe('none');
    expect(expiryStatus({ expires: null }, NOW).state).toBe('none');
  });

  it('does not throw on a missing credential', () => {
    expect(() => expiryStatus(null, NOW)).not.toThrow();
    expect(expiryStatus(undefined, NOW).state).toBe('none');
  });
});

describe('describeCredential', () => {
  const entry = (password, credential = {}) => ({ password, fields: { credential } });

  it('summarises issuer, masking and expiry together', () => {
    const d = describeCredential(
      entry('sk_live_EXAMPLE-not-a-real-key', {
        environment: 'production',
        expires: NOW + 5 * DAY,
      }),
      NOW,
    );
    expect(d.provider).toBe('Stripe');
    expect(d.environment).toBe('production');
    expect(d.status.state).toBe('expiring');
    expect(d.masked).not.toContain('9f2c1ab7d4e5');
  });

  it('flags a production-looking key filed as something else', () => {
    // The gap that gets a live key handled like a test one.
    const d = describeCredential(
      entry('sk_live_abc123456789', { environment: 'development' }),
      NOW,
    );
    expect(d.misfiled).toBe(true);
  });

  it('does not flag a key whose environment is simply unset', () => {
    // Unset is not a contradiction, and nagging about it would bury the real
    // mismatches.
    expect(describeCredential(entry('sk_live_abc123456789', {}), NOW).misfiled).toBe(false);
  });

  it('does not flag a test key filed as development', () => {
    expect(
      describeCredential(entry('sk_test_abc123456789', { environment: 'development' }), NOW)
        .misfiled,
    ).toBe(false);
  });

  it('never puts the raw secret in its own output', () => {
    // This object feeds list rows and Watchtower, both of which get rendered
    // in bulk. A secret leaking into it leaks everywhere at once.
    const secret = 'sk_live_EXAMPLE-not-a-real-key';
    const d = describeCredential(entry(secret, { environment: 'production' }), NOW);
    expect(JSON.stringify(d)).not.toContain(secret);
  });

  it('handles an entry with no credential fields at all', () => {
    expect(() => describeCredential({ password: 'x' }, NOW)).not.toThrow();
    expect(() => describeCredential({}, NOW)).not.toThrow();
  });
});

describe('the option lists', () => {
  it('offers the credential kinds 1Password does', () => {
    const ids = CREDENTIAL_TYPES.map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(['apiKey', 'bearer', 'pat', 'oauth', 'jwt']));
  });

  it('orders environments by blast radius, most severe first', () => {
    expect(ENVIRONMENTS[0].id).toBe('production');
    expect(ENVIRONMENTS[0].severe).toBe(true);
  });

  it('ends with an explicit "not set" rather than defaulting to production', () => {
    expect(ENVIRONMENTS.at(-1).id).toBe('unknown');
  });
});
