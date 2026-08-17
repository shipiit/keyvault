import { describe, it, expect } from 'vitest';
import {
  toHostname,
  hostMatches,
  entryMatchesUrl,
  entriesForUrl,
} from '../../src/core/url-match.js';

describe('toHostname', () => {
  it('extracts the host from a full URL', () => {
    expect(toHostname('https://github.com/login')).toBe('github.com');
    expect(toHostname('http://example.com:8080/a?b=c')).toBe('example.com');
  });

  it('accepts a bare host, as users typically save them', () => {
    expect(toHostname('github.com')).toBe('github.com');
    expect(toHostname('login.bank.co.uk')).toBe('login.bank.co.uk');
  });

  it('lowercases the host', () => {
    expect(toHostname('https://GitHub.COM')).toBe('github.com');
  });

  it('strips a trailing root dot', () => {
    expect(toHostname('https://github.com./login')).toBe('github.com');
  });

  it('rejects non-web schemes outright', () => {
    // A javascript: or data: URL must never be treated as a fillable origin.
    expect(toHostname('javascript:alert(1)')).toBeNull();
    expect(toHostname('data:text/html,<h1>hi</h1>')).toBeNull();
    expect(toHostname('file:///etc/passwd')).toBeNull();
    expect(toHostname('chrome://settings')).toBeNull();
  });

  it('rejects empty and malformed values', () => {
    expect(toHostname('')).toBeNull();
    expect(toHostname('   ')).toBeNull();
    expect(toHostname(null)).toBeNull();
    expect(toHostname('https://')).toBeNull();
  });
});

describe('hostMatches', () => {
  it('matches an exact host', () => {
    expect(hostMatches('github.com', 'github.com')).toBe(true);
  });

  it('matches a subdomain of the saved host', () => {
    expect(hostMatches('bank.com', 'login.bank.com')).toBe(true);
    expect(hostMatches('bank.com', 'secure.login.bank.com')).toBe(true);
  });

  it('does not match a parent of the saved host', () => {
    expect(hostMatches('login.bank.com', 'bank.com')).toBe(false);
  });

  it('defeats the suffix-lookalike phishing shape', () => {
    // The attack this function exists to stop.
    expect(hostMatches('bank.com', 'bank.com.evil.co')).toBe(false);
    expect(hostMatches('bank.com', 'evil-bank.com')).toBe(false);
    expect(hostMatches('bank.com', 'notbank.com')).toBe(false);
  });

  it('does not match an unrelated host', () => {
    expect(hostMatches('github.com', 'gitlab.com')).toBe(false);
  });

  it('returns false for null inputs', () => {
    expect(hostMatches(null, 'github.com')).toBe(false);
    expect(hostMatches('github.com', null)).toBe(false);
  });
});

describe('entryMatchesUrl', () => {
  const entry = { urls: ['https://github.com', 'gist.github.com'] };

  it('matches any of the saved URLs', () => {
    expect(entryMatchesUrl(entry, 'https://github.com/login')).toBe(true);
    expect(entryMatchesUrl(entry, 'https://gist.github.com/x')).toBe(true);
  });

  it('matches a subdomain of a saved URL', () => {
    expect(entryMatchesUrl(entry, 'https://api.github.com')).toBe(true);
  });

  it('does not match an unrelated site', () => {
    expect(entryMatchesUrl(entry, 'https://evil.com')).toBe(false);
  });

  it('does not match when the entry has no URLs', () => {
    expect(entryMatchesUrl({ urls: [] }, 'https://github.com')).toBe(false);
    expect(entryMatchesUrl({}, 'https://github.com')).toBe(false);
  });

  it('does not match a non-web page URL', () => {
    expect(entryMatchesUrl(entry, 'chrome://extensions')).toBe(false);
  });
});

describe('entriesForUrl', () => {
  const entries = [
    { id: 'a', urls: ['github.com'], lastUsedAt: 100 },
    { id: 'b', urls: ['github.com'], lastUsedAt: 300 },
    { id: 'c', urls: ['example.com'], lastUsedAt: 500 },
    { id: 'd', urls: ['github.com'], lastUsedAt: null },
  ];

  it('returns only matching entries', () => {
    expect(entriesForUrl(entries, 'https://github.com').map((e) => e.id)).toEqual(['b', 'a', 'd']);
  });

  it('orders most recently used first, with never-used last', () => {
    const ids = entriesForUrl(entries, 'https://github.com').map((e) => e.id);
    expect(ids[0]).toBe('b');
    expect(ids.at(-1)).toBe('d');
  });

  it('returns an empty array when nothing matches', () => {
    expect(entriesForUrl(entries, 'https://nowhere.test')).toEqual([]);
  });
});
