import { describe, it, expect } from 'vitest';
import {
  resolveBrowserApi,
  supportsTrustedContexts,
  describeBrowser,
} from '../../src/background/browser-api.js';
import { createFakeChrome } from '../helpers/fake-chrome.js';
import {
  createSessionKeyStore,
  UnsupportedBrowserError,
} from '../../src/background/session-key.js';
import { deriveKey } from '../../src/core/kdf.js';
import { utf8Encode } from '../../src/core/encoding.js';

describe('resolveBrowserApi', () => {
  it('prefers the chrome namespace, which every Chromium browser exposes', () => {
    const chrome = { runtime: {} };
    expect(resolveBrowserApi({ chrome })).toBe(chrome);
  });

  it('falls back to the browser namespace', () => {
    const browser = { runtime: {} };
    expect(resolveBrowserApi({ browser })).toBe(browser);
  });

  it('throws where no extension API exists', () => {
    expect(() => resolveBrowserApi({})).toThrow(/Chromium-based browser/);
    expect(() => resolveBrowserApi({ chrome: {} })).toThrow(/Chromium-based browser/);
  });
});

describe('supportsTrustedContexts', () => {
  it('detects the capability when present', () => {
    expect(supportsTrustedContexts(createFakeChrome())).toBe(true);
  });

  it('reports absence rather than assuming', () => {
    expect(supportsTrustedContexts({ storage: { session: {} } })).toBe(false);
    expect(supportsTrustedContexts({ storage: {} })).toBe(false);
    expect(supportsTrustedContexts({})).toBe(false);
    expect(supportsTrustedContexts(null)).toBe(false);
  });
});

describe('failing closed on a browser without trusted contexts', () => {
  const params = { hash: 'SHA-256', iterations: 1000, salt: utf8Encode('saltsaltsaltsalt') };

  /** A Chromium fork with storage.session but no setAccessLevel. */
  function chromeWithoutAccessLevel() {
    const chrome = createFakeChrome();
    delete chrome.storage.session.setAccessLevel;
    return chrome;
  }

  it('refuses to initialize', async () => {
    const store = createSessionKeyStore(chromeWithoutAccessLevel());
    await expect(store.initialize()).rejects.toThrow(UnsupportedBrowserError);
  });

  it('refuses to store the key rather than storing it unprotected', async () => {
    // The failure mode this guards against: session storage still works, so
    // everything appears fine, while any content script can read the key.
    const chrome = chromeWithoutAccessLevel();
    const store = createSessionKeyStore(chrome);
    const key = await deriveKey('pw', params, { extractable: true });

    await expect(store.store(key)).rejects.toThrow(UnsupportedBrowserError);
    expect(chrome.storage.session.data.size).toBe(0);
  });

  it('explains why in terms a user can act on', async () => {
    const store = createSessionKeyStore(chromeWithoutAccessLevel());
    await expect(store.initialize()).rejects.toThrow(/could be read by any web page/);
  });
});

describe('describeBrowser', () => {
  const ua = {
    chrome:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    edge: 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0',
    opera:
      'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36 OPR/114.0.0.0',
    vivaldi:
      'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36 Vivaldi/6.8',
  };

  it('identifies Chromium forks that also claim to be Chrome', () => {
    expect(describeBrowser(ua.edge).name).toBe('Edge');
    expect(describeBrowser(ua.opera).name).toBe('Opera');
    expect(describeBrowser(ua.vivaldi).name).toBe('Vivaldi');
    expect(describeBrowser(ua.chrome).name).toBe('Chrome');
  });

  it('extracts the Chromium version', () => {
    expect(describeBrowser(ua.edge).chromiumVersion).toBe(128);
  });

  it('degrades gracefully on an unrecognised agent', () => {
    expect(describeBrowser('something else')).toEqual({ name: 'Unknown', chromiumVersion: null });
    expect(describeBrowser('')).toEqual({ name: 'Unknown', chromiumVersion: null });
  });
});
