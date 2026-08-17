/**
 * Deciding whether a saved credential belongs to the page asking for it.
 *
 * This is the check that stands between a user's credentials and a phishing
 * site, so it fails closed: anything unparseable, non-HTTPS-or-HTTP, or
 * ambiguous returns no match rather than guessing.
 */

/**
 * Extract a comparable hostname from a stored URL or a bare host string.
 *
 * Entries are often saved as `github.com` rather than `https://github.com`,
 * so a bare host is accepted, but anything that does not resolve to a plain
 * hostname is rejected.
 *
 * @param {string} value
 * @returns {string|null} lowercase hostname, or null
 */
export function toHostname(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  const raw = value.trim();
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;

  let url;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  // Only web origins. A `javascript:` or `data:` URL must never match.
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return null;
  }
  return url.hostname.toLowerCase().replace(/\.$/, '') || null;
}

/**
 * Whether `pageHost` is the same site as, or a subdomain of, `entryHost`.
 *
 * Matching runs right-to-left on label boundaries, which is what defeats the
 * common phishing shape: `bank.com.evil.co` does not end in `bank.com` at a
 * label boundary, so it does not match an entry saved for `bank.com`.
 * `login.bank.com` does, and should.
 *
 * **Known limitation:** without the Public Suffix List this cannot tell a
 * registrable domain from a registry suffix, so an entry saved for a bare
 * public suffix such as `co.uk` would match every site under it. Guarding
 * that properly needs the PSL, which is a Stage 4 item. Until then the risk
 * is bounded by the fact that a user has no reason to save an entry for a
 * bare suffix.
 *
 * @param {string} entryHost
 * @param {string} pageHost
 * @returns {boolean}
 */
export function hostMatches(entryHost, pageHost) {
  if (entryHost === null || pageHost === null) {
    return false;
  }
  if (entryHost === pageHost) {
    return true;
  }
  return pageHost.endsWith(`.${entryHost}`);
}

/**
 * Whether any of an entry's saved URLs matches the given page URL.
 *
 * @param {object} entry
 * @param {string} pageUrl
 * @returns {boolean}
 */
export function entryMatchesUrl(entry, pageUrl) {
  const pageHost = toHostname(pageUrl);
  if (pageHost === null || !Array.isArray(entry.urls)) {
    return false;
  }
  return entry.urls.some((url) => hostMatches(toHostname(url), pageHost));
}

/**
 * Entries whose saved URLs match the page, most recently used first.
 *
 * @param {object[]} entries
 * @param {string} pageUrl
 * @returns {object[]}
 */
export function entriesForUrl(entries, pageUrl) {
  return entries
    .filter((entry) => entryMatchesUrl(entry, pageUrl))
    .sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0));
}
