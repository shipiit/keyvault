/**
 * Cross-browser access to the extension API.
 *
 * Every Chromium-based browser — Chrome, Edge, Brave, Opera, Vivaldi, Arc —
 * exposes the same Manifest V3 surface under the `chrome` namespace, so the
 * extension needs no per-browser branching. Firefox uses `browser` with
 * promise-returning methods; it is not a supported target today (its MV3
 * background model differs), but resolving both namespaces here means the
 * rest of the codebase never touches a global directly, and a future Firefox
 * port changes one file.
 *
 * @returns {object} the extension API namespace
 */
export function resolveBrowserApi(scope = globalThis) {
  const api = scope.chrome ?? scope.browser;
  if (api === undefined || api.runtime === undefined) {
    throw new Error('no extension API available: this build requires a Chromium-based browser');
  }
  return api;
}

/**
 * Whether this browser can restrict session storage to trusted contexts.
 *
 * `storage.session.setAccessLevel` is what prevents a content script — and so
 * any web page — from reading the unlocked vault key. It is not present on
 * every Chromium build, and an older fork could ship `storage.session`
 * without it.
 *
 * Callers must treat a `false` here as disqualifying, not as a warning. A
 * missing restriction does not degrade the feature; it removes the boundary
 * the key's confidentiality depends on.
 *
 * @param {object} api
 * @returns {boolean}
 */
export function supportsTrustedContexts(api) {
  return typeof api?.storage?.session?.setAccessLevel === 'function';
}

/**
 * A short description of the host browser, for diagnostics and bug reports.
 *
 * Derived from the user agent, which is advisory only — nothing security
 * relevant may branch on it. Capability checks do that job.
 *
 * @param {string} [userAgent]
 * @returns {{name: string, chromiumVersion: number|null}}
 */
export function describeBrowser(userAgent = globalThis.navigator?.userAgent ?? '') {
  const chromiumMatch = /Chrome\/(\d+)/.exec(userAgent);
  const chromiumVersion = chromiumMatch === null ? null : Number(chromiumMatch[1]);

  // Order matters: these browsers all also identify as Chrome, so the more
  // specific token has to win.
  const brands = [
    ['Edge', /\bEdg\//],
    ['Opera', /\bOPR\//],
    ['Vivaldi', /\bVivaldi\//],
    ['Brave', /\bBrave\//],
    ['Chrome', /\bChrome\//],
  ];
  const match = brands.find(([, pattern]) => pattern.test(userAgent));
  return { name: match === undefined ? 'Unknown' : match[0], chromiumVersion };
}
