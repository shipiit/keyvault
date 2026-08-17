/**
 * Where to send someone who wants to change a password.
 *
 * There is a standard for this — "A Well-Known URL for Changing Passwords" —
 * which reserves `/.well-known/change-password` on every origin. A site that
 * implements it redirects that path to wherever its change-password form
 * lives, so a password manager can offer a working button without knowing
 * anything about the site.
 *
 * Support is good among large sites and absent among small ones, and there is
 * no way to tell which you are dealing with without making a request — which
 * this extension will not do, because asking a site about an account is
 * exactly the kind of quiet network traffic a vault should not generate. So
 * the honest design is: offer the standard path, and offer the site's home
 * page beside it, and say plainly that the first may not exist. A button that
 * usually works and admits when it might not beats a probe that leaks which
 * sites you hold accounts for.
 */

/** The path reserved by the specification. Not ours to choose. */
export const CHANGE_PASSWORD_PATH = '/.well-known/change-password';

/**
 * The change-password URL for an entry, or null.
 *
 * @param {object} entry
 * @returns {{changeUrl: string, siteUrl: string, host: string}|null}
 */
export function changePasswordTarget(entry) {
  for (const candidate of entry?.urls ?? []) {
    const target = targetForUrl(candidate);
    if (target !== null) {
      return target;
    }
  }
  return null;
}

/**
 * @param {string} rawUrl
 * @returns {{changeUrl: string, siteUrl: string, host: string}|null}
 */
export function targetForUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    return null;
  }

  let parsed;
  try {
    // A bare "github.com" is what people actually type, and it is not a URL
    // until something supplies a scheme.
    parsed = new URL(/^[a-z][a-z0-9+.-]*:/i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
  } catch {
    return null;
  }

  // Only the web. A `javascript:` or `file:` entry must never become
  // something the UI offers to open — that is a link the user did not write
  // turning into code that runs.
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null;
  }
  if (parsed.hostname === '') {
    return null;
  }

  // The path is dropped deliberately. The well-known URL is defined relative
  // to the origin, so a stored deep link like /login/callback must not end up
  // as /login/callback/.well-known/change-password.
  const origin = `${parsed.protocol}//${parsed.host}`;
  return {
    changeUrl: `${origin}${CHANGE_PASSWORD_PATH}`,
    siteUrl: `${origin}/`,
    host: parsed.hostname,
  };
}
