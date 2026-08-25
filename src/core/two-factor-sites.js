/**
 * Sites known to support two-factor authentication.
 *
 * Watchtower's most useful check, and the one KeyVault could not make: it
 * knows which of your logins have a code stored, but not which of the rest
 * *could* have one. Without that, "no two-factor" is only ever a statement
 * about your vault, never a suggestion you can act on.
 *
 * 1Password answers this from a hosted dataset. Fetching one would mean
 * sending a list of the sites you hold accounts on to somebody, which is the
 * single most sensitive thing this vault holds — so the list is bundled
 * instead. That trades completeness for silence, and the trade is the right
 * way round: a check that covers the largest sites and never speaks is worth
 * more here than a complete one that phones home.
 *
 * The list is registrable domains only, kept deliberately short and
 * uncontroversial. Every entry is a site whose two-factor support is public
 * and long-standing; the cost of a wrong entry is nagging somebody to enable
 * something that does not exist, so anything uncertain is left out.
 */

/** Registrable domains with well-established two-factor support. */
const SUPPORTS_2FA = Object.freeze(
  new Set([
    // Identity and email
    'google.com',
    'gmail.com',
    'microsoft.com',
    'outlook.com',
    'live.com',
    'apple.com',
    'icloud.com',
    'yahoo.com',
    'proton.me',
    'protonmail.com',
    'fastmail.com',
    'zoho.com',
    // Developer
    'github.com',
    'gitlab.com',
    'bitbucket.org',
    'npmjs.com',
    'pypi.org',
    'docker.com',
    'vercel.com',
    'netlify.com',
    'heroku.com',
    'digitalocean.com',
    'cloudflare.com',
    'aws.amazon.com',
    'atlassian.com',
    'jetbrains.com',
    'sentry.io',
    'circleci.com',
    // Money
    'stripe.com',
    'paypal.com',
    'wise.com',
    'coinbase.com',
    'revolut.com',
    'squareup.com',
    'xero.com',
    'quickbooks.intuit.com',
    // Work
    'slack.com',
    'notion.so',
    'figma.com',
    'dropbox.com',
    'box.com',
    'zoom.us',
    'asana.com',
    'linear.app',
    'trello.com',
    'salesforce.com',
    'hubspot.com',
    'mailchimp.com',
    'shopify.com',
    'squarespace.com',
    'wordpress.com',
    'godaddy.com',
    'namecheap.com',
    // Social and consumer
    'facebook.com',
    'instagram.com',
    'x.com',
    'twitter.com',
    'linkedin.com',
    'reddit.com',
    'discord.com',
    'twitch.tv',
    'steampowered.com',
    'epicgames.com',
    'amazon.com',
    'ebay.com',
    'booking.com',
    'airbnb.com',
    'netflix.com',
    'spotify.com',
  ]),
);

/**
 * How many sites the bundled list covers.
 *
 * Surfaced in the UI so the check can say what it does not know, rather than
 * implying an absence of findings means an absence of gaps.
 */
export function knownSiteCount() {
  return SUPPORTS_2FA.size;
}

/**
 * The registrable domain of a hostname, for the suffixes this list uses.
 *
 * Deliberately simple: a full public-suffix implementation is a large table
 * that would need updating, and this only has to fold `accounts.google.com`
 * onto `google.com` well enough to look up a bundled entry. Anything it gets
 * wrong falls through to "unknown", which is the safe direction — the check
 * stays quiet rather than nagging.
 *
 * @param {string} hostname
 * @returns {string|null}
 */
export function registrableDomain(hostname) {
  if (typeof hostname !== 'string' || hostname.trim() === '') {
    return null;
  }
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (host === '' || host.includes(' ')) {
    return null;
  }
  const parts = host.split('.').filter(Boolean);
  if (parts.length < 2) {
    return null;
  }

  // Two-part public suffixes common enough to matter here. Without these,
  // `example.co.uk` would fold to `co.uk`.
  const twoPart = new Set(['co.uk', 'org.uk', 'ac.uk', 'com.au', 'co.jp', 'co.nz', 'com.br']);
  const lastTwo = parts.slice(-2).join('.');
  if (twoPart.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return lastTwo;
}

/**
 * Does this site support two-factor authentication, as far as we know?
 *
 * Returns null for "not in the list" rather than false. The distinction is
 * the whole point: false would let the UI say "this site has no two-factor",
 * which the bundled list cannot possibly support.
 *
 * @param {string} url
 * @returns {boolean|null}
 */
export function supportsTwoFactor(url) {
  let host = null;
  try {
    const parsed = new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`);
    host = parsed.hostname;
  } catch {
    return null;
  }

  const domain = registrableDomain(host);
  if (domain === null) {
    return null;
  }
  // Check the full host too: `aws.amazon.com` is listed separately from
  // `amazon.com`, and folding it away would answer for the wrong site.
  if (SUPPORTS_2FA.has(host) || SUPPORTS_2FA.has(domain)) {
    return true;
  }
  return null;
}

/**
 * Logins on a known-2FA site that have no code stored.
 *
 * @param {object[]} entries
 * @returns {Array<{id: string, title: string, site: string}>}
 */
export function findMissingTwoFactor(entries) {
  const found = [];
  for (const entry of entries ?? []) {
    if ((entry?.type ?? 'login') !== 'login' || typeof entry?.deletedAt === 'number') {
      continue;
    }
    if (entry.totp !== null && entry.totp !== undefined) {
      continue;
    }
    for (const url of entry.urls ?? []) {
      if (supportsTwoFactor(url) === true) {
        found.push({ id: entry.id, title: entry.title, site: registrableDomain(hostOf(url)) });
        break;
      }
    }
  }
  return found;
}

/** @param {string} url */
function hostOf(url) {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`).hostname;
  } catch {
    return '';
  }
}
