import { isNewerVersion, VersionError } from '../core/version.js';

/**
 * Checking whether a newer release exists.
 *
 * This is the second — and, by intent, last — piece of network code in
 * KeyVault. It exists because of how the extension is installed: a
 * "Load unpacked" extension is never updated by Chrome, ever. Without this
 * you would run whatever you built months ago and have no way of knowing a
 * fix had shipped, which for a password manager is a security problem rather
 * than an inconvenience.
 *
 * What it sends: an unauthenticated GET to the public releases endpoint of
 * one fixed repository. No account, no vault identifier, no installation id,
 * no version number, no telemetry of any kind. GitHub learns that somebody at
 * your IP asked about a public repository, which is what it learns from
 * anyone opening the page in a browser.
 *
 * What it deliberately does not do: download or install anything. It reports
 * that a release exists and links to it. An extension that could update
 * itself from the network would be a far larger piece of attack surface than
 * the problem justifies.
 */

const RELEASES_API = 'https://api.github.com/repos/shipiit/keyvault/releases/latest';
const TIMEOUT_MS = 8000;

/** How long a result is reused before asking again. */
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Where the last result is cached. */
export const UPDATE_CACHE_KEY = 'keyvault.updateCheck';

/**
 * @param {object} options
 * @param {typeof fetch} [options.fetchImpl] injectable for tests
 * @param {() => number} [options.now]
 */
export function createUpdateService({ fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  return {
    /**
     * Ask GitHub for the latest release.
     *
     * @param {string} installedVersion
     * @param {{enabled: boolean}} settings
     * @returns {Promise<object>} never throws; failure is a status
     */
    async check(installedVersion, { enabled }) {
      if (enabled !== true) {
        return { status: 'disabled' };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const response = await fetchImpl(RELEASES_API, {
          signal: controller.signal,
          headers: { Accept: 'application/vnd.github+json' },
          // No credentials, ever. A cookie riding along would turn an
          // anonymous request into an identified one.
          credentials: 'omit',
          cache: 'no-store',
        });

        if (response.status === 404) {
          // No release has been published yet. That is a definite answer —
          // "you are current" — not a failure to reach the network.
          return { status: 'ok', updateAvailable: false, checkedAt: now() };
        }
        if (!response.ok) {
          return { status: 'unavailable', reason: `HTTP ${response.status}`, checkedAt: now() };
        }

        const release = await response.json();
        const latest = release?.tag_name ?? release?.name;
        if (typeof latest !== 'string') {
          return { status: 'unavailable', reason: 'no version in response', checkedAt: now() };
        }

        // A draft is not published, and a pre-release is not something to
        // push at everyone. Either would nag people toward a build that was
        // not meant for them.
        if (release.draft === true || release.prerelease === true) {
          return { status: 'ok', updateAvailable: false, checkedAt: now() };
        }

        return {
          status: 'ok',
          updateAvailable: isNewerVersion(latest, installedVersion),
          latestVersion: latest.replace(/^v/i, ''),
          installedVersion,
          // Only ever a link. Nothing is downloaded or executed.
          url: typeof release.html_url === 'string' ? release.html_url : null,
          notes: typeof release.body === 'string' ? release.body.slice(0, 2000) : null,
          publishedAt: release.published_at ?? null,
          checkedAt: now(),
        };
      } catch (error) {
        if (error instanceof VersionError) {
          // A tag that is not a version tells us nothing about whether we are
          // behind. Saying so is better than inventing an answer.
          return { status: 'unavailable', reason: 'unreadable release tag', checkedAt: now() };
        }
        const reason = error?.name === 'AbortError' ? 'timed out' : 'network unavailable';
        return { status: 'unavailable', reason, checkedAt: now() };
      } finally {
        clearTimeout(timer);
      }
    },

    /**
     * The cached answer, refreshed at most once a day.
     *
     * The cache is what keeps this from being a request on every popup open.
     *
     * @param {object} chrome
     * @param {string} installedVersion
     * @param {{enabled: boolean}} settings
     * @param {{force?: boolean}} [options]
     */
    async cachedCheck(chrome, installedVersion, settings, options = {}) {
      if (settings.enabled !== true) {
        return { status: 'disabled' };
      }

      const stored = await chrome.storage.local.get(UPDATE_CACHE_KEY);
      const cached = stored[UPDATE_CACHE_KEY];

      const fresh =
        cached !== undefined &&
        typeof cached.checkedAt === 'number' &&
        now() - cached.checkedAt < CHECK_INTERVAL_MS &&
        // A cached answer about a version you are no longer running is
        // meaningless — rebuilding at a new version must re-ask.
        cached.installedVersion === installedVersion;

      if (fresh && options.force !== true) {
        return cached;
      }

      const result = await this.check(installedVersion, settings);
      // A failed check is not cached: it would suppress the next 24 hours of
      // attempts over one flaky moment.
      if (result.status === 'ok') {
        await chrome.storage.local.set({
          [UPDATE_CACHE_KEY]: { ...result, installedVersion },
        });
      }
      return result;
    },

    /** Forget any cached answer. */
    async clearCache(chrome) {
      await chrome.storage.local.remove(UPDATE_CACHE_KEY);
    },
  };
}
