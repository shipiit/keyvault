import { describe, it, expect } from 'vitest';
import {
  changePasswordTarget,
  targetForUrl,
  CHANGE_PASSWORD_PATH,
} from '../../src/core/change-password-url.js';

describe('targetForUrl', () => {
  it('points at the standard path on the site s origin', () => {
    expect(targetForUrl('https://github.com')).toEqual({
      changeUrl: `https://github.com${CHANGE_PASSWORD_PATH}`,
      siteUrl: 'https://github.com/',
      host: 'github.com',
    });
  });

  it('drops the stored path, which is usually a deep link', () => {
    // The well-known URL is defined relative to the origin. Appending it to a
    // saved login path would produce /login/callback/.well-known/... , which
    // exists nowhere.
    expect(targetForUrl('https://example.com/login/callback?next=/home').changeUrl).toBe(
      `https://example.com${CHANGE_PASSWORD_PATH}`,
    );
  });

  it('keeps the port, so a local service still resolves', () => {
    expect(targetForUrl('http://localhost:8000/login').changeUrl).toBe(
      `http://localhost:8000${CHANGE_PASSWORD_PATH}`,
    );
  });

  it('keeps the subdomain rather than guessing at the parent', () => {
    // accounts.example.com and example.com are different origins and may have
    // entirely different sign-in systems.
    expect(targetForUrl('https://accounts.example.com').host).toBe('accounts.example.com');
  });

  it('accepts what people actually type, with no scheme', () => {
    expect(targetForUrl('github.com').changeUrl).toBe(`https://github.com${CHANGE_PASSWORD_PATH}`);
  });

  it('preserves http rather than silently upgrading it', () => {
    // Quietly rewriting to https sends the user somewhere that may not exist
    // and hides that their saved entry is not on a secure origin.
    expect(targetForUrl('http://internal.example.com').changeUrl).toMatch(/^http:\/\//);
  });

  it('refuses anything that is not the web', () => {
    // The whole point of this feature is producing something the UI will
    // open. A javascript: entry becoming an opened link is a saved field
    // turning into executed code.
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'chrome-extension://abc/page.html',
    ]) {
      expect(targetForUrl(bad), bad).toBeNull();
    }
  });

  it('refuses nonsense without throwing', () => {
    for (const bad of ['', '   ', null, undefined, 42, 'https://']) {
      expect(targetForUrl(bad), String(bad)).toBeNull();
    }
  });
});

describe('changePasswordTarget', () => {
  it('uses the entry s first usable URL', () => {
    const entry = { urls: ['https://github.com/login'] };
    expect(changePasswordTarget(entry).host).toBe('github.com');
  });

  it('skips over an unusable URL to reach a usable one', () => {
    const entry = { urls: ['javascript:void(0)', 'https://real.example.com'] };
    expect(changePasswordTarget(entry).host).toBe('real.example.com');
  });

  it('returns null when the entry has no URL at all', () => {
    // Common for imported items, and the UI must hide the button rather than
    // offer one that goes nowhere.
    for (const entry of [{ urls: [] }, {}, null, undefined]) {
      expect(changePasswordTarget(entry)).toBeNull();
    }
  });
});
