import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeChrome } from '../helpers/fake-chrome.js';
import {
  createUpdateService,
  CHECK_INTERVAL_MS,
  UPDATE_CACHE_KEY,
} from '../../src/background/update-service.js';

const ON = { enabled: true };
const NOW = 1_700_000_000_000;

function respondWith(body, init = {}) {
  return vi.fn(async () => ({
    ok: init.status === undefined || (init.status >= 200 && init.status < 300),
    status: init.status ?? 200,
    json: async () => body,
  }));
}

describe('createUpdateService', () => {
  let chrome;

  beforeEach(() => {
    chrome = createFakeChrome();
  });

  describe('consent', () => {
    it('sends nothing at all when the check is switched off', async () => {
      const fetchImpl = vi.fn();
      const service = createUpdateService({ fetchImpl, now: () => NOW });

      expect(await service.check('0.1.0', { enabled: false })).toEqual({ status: 'disabled' });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('sends nothing when the setting is merely absent', async () => {
      // Fails closed. A missing setting must never be read as consent.
      const fetchImpl = vi.fn();
      const service = createUpdateService({ fetchImpl, now: () => NOW });

      await service.check('0.1.0', {});
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });

  describe('what leaves the machine', () => {
    it('asks one fixed public URL, with no credentials and no query', async () => {
      const fetchImpl = respondWith({ tag_name: 'v0.1.0' });
      await createUpdateService({ fetchImpl, now: () => NOW }).check('0.1.0', ON);

      const [url, init] = fetchImpl.mock.calls[0];
      expect(url).toBe('https://api.github.com/repos/shipiit/keyvault/releases/latest');
      expect(url).not.toContain('?');
      expect(init.credentials).toBe('omit');
    });

    it('carries no identifying information whatsoever', async () => {
      // Everything except the fixed URL is inspected: a version number or an
      // installation id smuggled into a header would be exactly as bad as one
      // in a query string. The URL itself is asserted separately, by exact
      // match, which is stricter than any substring search could be.
      const fetchImpl = respondWith({ tag_name: 'v0.1.0' });
      await createUpdateService({ fetchImpl, now: () => NOW }).check('0.1.0', ON);

      const [, init] = fetchImpl.mock.calls[0];
      const serialised = JSON.stringify({ ...init, signal: undefined }).toLowerCase();
      for (const term of ['0.1.0', 'user', 'install', 'token', 'id=', 'uuid', 'client']) {
        expect(serialised, `request options must not contain "${term}"`).not.toContain(term);
      }
      // Only the two headers it needs, and nothing resembling a cookie.
      expect(Object.keys(init.headers)).toEqual(['Accept']);
    });
  });

  describe('reading the answer', () => {
    it('reports an update when the release is newer', async () => {
      const fetchImpl = respondWith({
        tag_name: 'v0.2.0',
        html_url: 'https://github.com/shipiit/keyvault/releases/tag/v0.2.0',
        body: 'Fixed a thing.',
      });
      const result = await createUpdateService({ fetchImpl, now: () => NOW }).check('0.1.0', ON);

      expect(result.status).toBe('ok');
      expect(result.updateAvailable).toBe(true);
      expect(result.latestVersion).toBe('0.2.0');
      expect(result.url).toContain('releases/tag/v0.2.0');
    });

    it('reports no update when the release matches what is installed', async () => {
      const fetchImpl = respondWith({ tag_name: 'v0.1.0' });
      const result = await createUpdateService({ fetchImpl, now: () => NOW }).check('0.1.0', ON);
      expect(result.updateAvailable).toBe(false);
    });

    it('never offers a downgrade', async () => {
      const fetchImpl = respondWith({ tag_name: 'v0.0.9' });
      const result = await createUpdateService({ fetchImpl, now: () => NOW }).check('0.1.0', ON);
      expect(result.updateAvailable).toBe(false);
    });

    it('ignores drafts and pre-releases', async () => {
      // Neither was meant for everyone; offering them nags people toward a
      // build that was not published for them.
      for (const flags of [{ draft: true }, { prerelease: true }]) {
        const fetchImpl = respondWith({ tag_name: 'v9.9.9', ...flags });
        const result = await createUpdateService({ fetchImpl, now: () => NOW }).check('0.1.0', ON);
        expect(result.updateAvailable, JSON.stringify(flags)).toBe(false);
      }
    });

    it('treats "no releases yet" as current, not as a failure', async () => {
      const fetchImpl = respondWith({}, { status: 404 });
      const result = await createUpdateService({ fetchImpl, now: () => NOW }).check('0.1.0', ON);
      expect(result.status).toBe('ok');
      expect(result.updateAvailable).toBe(false);
    });
  });

  describe('when it goes wrong', () => {
    it('reports unavailable rather than claiming you are current', async () => {
      // The dangerous failure: an error read as "up to date" leaves someone
      // on a stale build believing otherwise.
      const fetchImpl = vi.fn(async () => {
        throw new Error('offline');
      });
      const result = await createUpdateService({ fetchImpl, now: () => NOW }).check('0.1.0', ON);

      expect(result.status).toBe('unavailable');
      expect(result.updateAvailable).toBeUndefined();
    });

    it('survives a release tag that is not a version', async () => {
      const fetchImpl = respondWith({ tag_name: 'nightly' });
      const result = await createUpdateService({ fetchImpl, now: () => NOW }).check('0.1.0', ON);
      expect(result.status).toBe('unavailable');
      expect(result.reason).toMatch(/tag/i);
    });

    it('survives a response with no version at all', async () => {
      const fetchImpl = respondWith({ nothing: true });
      const result = await createUpdateService({ fetchImpl, now: () => NOW }).check('0.1.0', ON);
      expect(result.status).toBe('unavailable');
    });

    it('reports an HTTP error as unavailable', async () => {
      const fetchImpl = respondWith({}, { status: 503 });
      const result = await createUpdateService({ fetchImpl, now: () => NOW }).check('0.1.0', ON);
      expect(result.status).toBe('unavailable');
      expect(result.reason).toContain('503');
    });
  });

  describe('caching', () => {
    it('asks once a day, not once a popup', async () => {
      const fetchImpl = respondWith({ tag_name: 'v0.2.0' });
      let clock = NOW;
      const service = createUpdateService({ fetchImpl, now: () => clock });

      await service.cachedCheck(chrome, '0.1.0', ON);
      await service.cachedCheck(chrome, '0.1.0', ON);
      await service.cachedCheck(chrome, '0.1.0', ON);
      expect(fetchImpl).toHaveBeenCalledTimes(1);

      clock += CHECK_INTERVAL_MS + 1;
      await service.cachedCheck(chrome, '0.1.0', ON);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('re-asks after the extension itself is updated', async () => {
      // A cached answer about a version you are no longer running would go on
      // announcing an update you already installed.
      const fetchImpl = respondWith({ tag_name: 'v0.2.0' });
      const service = createUpdateService({ fetchImpl, now: () => NOW });

      await service.cachedCheck(chrome, '0.1.0', ON);
      await service.cachedCheck(chrome, '0.2.0', ON);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('does not cache a failure', async () => {
      // One flaky moment must not silence the next twenty-four hours.
      const fetchImpl = vi.fn(async () => {
        throw new Error('offline');
      });
      const service = createUpdateService({ fetchImpl, now: () => NOW });

      await service.cachedCheck(chrome, '0.1.0', ON);
      await service.cachedCheck(chrome, '0.1.0', ON);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('can be forced, for a Check now button', async () => {
      const fetchImpl = respondWith({ tag_name: 'v0.2.0' });
      const service = createUpdateService({ fetchImpl, now: () => NOW });

      await service.cachedCheck(chrome, '0.1.0', ON);
      await service.cachedCheck(chrome, '0.1.0', ON, { force: true });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('makes no request from the cache path when switched off', async () => {
      const fetchImpl = vi.fn();
      const service = createUpdateService({ fetchImpl, now: () => NOW });

      expect(await service.cachedCheck(chrome, '0.1.0', { enabled: false })).toEqual({
        status: 'disabled',
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('forgets its cache on request', async () => {
      const fetchImpl = respondWith({ tag_name: 'v0.2.0' });
      const service = createUpdateService({ fetchImpl, now: () => NOW });

      await service.cachedCheck(chrome, '0.1.0', ON);
      await service.clearCache(chrome);
      expect((await chrome.storage.local.get(UPDATE_CACHE_KEY))[UPDATE_CACHE_KEY]).toBeUndefined();
    });
  });

  it('never stores anything from the vault in its cache', async () => {
    const fetchImpl = respondWith({ tag_name: 'v0.2.0', body: 'notes' });
    const service = createUpdateService({ fetchImpl, now: () => NOW });
    await service.cachedCheck(chrome, '0.1.0', ON);

    const cached = (await chrome.storage.local.get(UPDATE_CACHE_KEY))[UPDATE_CACHE_KEY];
    expect(Object.keys(cached).sort()).toEqual(
      [
        'checkedAt',
        'installedVersion',
        'latestVersion',
        'notes',
        'publishedAt',
        'status',
        'updateAvailable',
        'url',
      ].sort(),
    );
  });
});
