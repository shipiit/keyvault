import { describe, it, expect } from 'vitest';
import {
  supportsTwoFactor,
  registrableDomain,
  findMissingTwoFactor,
  knownSiteCount,
} from '../../src/core/two-factor-sites.js';

describe('registrableDomain', () => {
  it('folds a subdomain onto its registrable domain', () => {
    expect(registrableDomain('accounts.google.com')).toBe('google.com');
    expect(registrableDomain('a.b.c.example.com')).toBe('example.com');
  });

  it('handles the two-part suffixes that would otherwise collapse to nothing', () => {
    // Without these, example.co.uk folds to co.uk and every UK site looks
    // like the same site.
    expect(registrableDomain('shop.example.co.uk')).toBe('example.co.uk');
    expect(registrableDomain('example.com.au')).toBe('example.com.au');
  });

  it('is case-insensitive and tolerates a trailing dot', () => {
    expect(registrableDomain('GitHub.COM.')).toBe('github.com');
  });

  it('returns null for anything that is not a hostname', () => {
    for (const value of ['', '   ', 'localhost', 'has space.com', null, undefined, 42]) {
      expect(registrableDomain(value), String(value)).toBeNull();
    }
  });
});

describe('supportsTwoFactor', () => {
  it('recognises a listed site, with or without a scheme or path', () => {
    expect(supportsTwoFactor('https://github.com/login')).toBe(true);
    expect(supportsTwoFactor('github.com')).toBe(true);
  });

  it('recognises a listed site reached by subdomain', () => {
    expect(supportsTwoFactor('https://accounts.google.com/signin')).toBe(true);
  });

  it('returns null — not false — for a site it has never heard of', () => {
    // The distinction is the whole point. False would let the UI claim a
    // site has no two-factor, which a bundled list cannot possibly support.
    expect(supportsTwoFactor('https://my-bank.example')).toBeNull();
    expect(supportsTwoFactor('https://intranet.local')).toBeNull();
  });

  it('returns null for junk rather than throwing', () => {
    for (const value of ['', 'not a url', null, undefined, 42, 'javascript:alert(1)']) {
      expect(supportsTwoFactor(value), String(value)).not.toBe(true);
    }
  });

  it('covers a useful number of sites', () => {
    expect(knownSiteCount()).toBeGreaterThan(50);
  });
});

describe('findMissingTwoFactor', () => {
  const login = (over = {}) => ({
    id: over.id ?? '1',
    type: over.type ?? 'login',
    title: over.title ?? 'GitHub',
    urls: over.urls ?? ['https://github.com/login'],
    totp: over.totp ?? null,
    deletedAt: over.deletedAt ?? null,
  });

  it('finds a login on a known site with no code stored', () => {
    const found = findMissingTwoFactor([login()]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ id: '1', site: 'github.com' });
  });

  it('says nothing about a login that already has a code', () => {
    expect(findMissingTwoFactor([login({ totp: { secret: 'x' } })])).toEqual([]);
  });

  it('says nothing about a site not on the list', () => {
    // Silence is correct here: the list cannot know, and a wrong nag trains
    // people to ignore the real ones.
    expect(findMissingTwoFactor([login({ urls: ['https://my-bank.example'] })])).toEqual([]);
  });

  it('ignores trashed entries and non-logins', () => {
    expect(findMissingTwoFactor([login({ deletedAt: 1 })])).toEqual([]);
    expect(findMissingTwoFactor([login({ type: 'apiKey' })])).toEqual([]);
  });

  it('reports an entry once even when several of its URLs qualify', () => {
    const found = findMissingTwoFactor([
      login({ urls: ['https://github.com', 'https://gitlab.com'] }),
    ]);
    expect(found).toHaveLength(1);
  });

  it('handles entries with no URLs at all', () => {
    expect(findMissingTwoFactor([login({ urls: [] })])).toEqual([]);
    expect(findMissingTwoFactor([{ id: 'x', type: 'login' }])).toEqual([]);
    expect(findMissingTwoFactor(null)).toEqual([]);
  });
});
