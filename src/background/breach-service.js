import { hashForRangeQuery, findSuffix, describeExposure } from '../core/breach-check.js';

/**
 * The **only** network code in KeyVault.
 *
 * Everything else in this extension is entirely local. This module exists
 * because breach checking is impossible without asking somebody who holds a
 * breach corpus, and it is written so that asking costs the user as little
 * privacy as the protocol allows.
 *
 * Guarantees this module must keep, and which its tests enforce:
 *
 * 1. It never runs unless the user has explicitly turned it on. Off by default.
 * 2. It sends a five-character hash prefix and nothing else — no password, no
 *    username, no URL, no vault identifier, no telemetry.
 * 3. It sets `Add-Padding`, so responses are padded to a uniform size and a
 *    network observer cannot infer the result from the response length.
 * 4. A failure is reported as "unknown", never as "safe". Silently downgrading
 *    an error to a clean bill of health is the worst thing a security check
 *    can do.
 */

const RANGE_API = 'https://api.pwnedpasswords.com/range/';
const TIMEOUT_MS = 8000;

/**
 * @param {object} options
 * @param {typeof fetch} [options.fetchImpl] injectable for tests
 */
export function createBreachService({ fetchImpl = globalThis.fetch } = {}) {
  return {
    /**
     * Check one password against the breach corpus.
     *
     * @param {string} password
     * @param {{enabled: boolean}} settings
     * @returns {Promise<{status: 'ok'|'disabled'|'unavailable', breached?: boolean,
     *                    occurrences?: number, exposure?: object, reason?: string}>}
     */
    async check(password, { enabled }) {
      if (enabled !== true) {
        // Fails closed on consent, not just on error: no opt-in, no request.
        return { status: 'disabled' };
      }

      const { prefix, suffix } = await hashForRangeQuery(password);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      try {
        const response = await fetchImpl(`${RANGE_API}${prefix}`, {
          method: 'GET',
          signal: controller.signal,
          // Pads every response to a uniform length, so an observer watching
          // packet sizes cannot tell a hit from a miss.
          headers: { 'Add-Padding': 'true' },
          // No cookies, no credentials, no cache entry tying this to the user.
          credentials: 'omit',
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
        });

        if (!response.ok) {
          return { status: 'unavailable', reason: `breach service returned ${response.status}` };
        }

        const { breached, occurrences } = findSuffix(await response.text(), suffix);
        return { status: 'ok', breached, occurrences, exposure: describeExposure(occurrences) };
      } catch (error) {
        // Offline, blocked, or timed out. "Unknown" — never "safe".
        return {
          status: 'unavailable',
          reason:
            error.name === 'AbortError' ? 'breach check timed out' : 'breach service unreachable',
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
