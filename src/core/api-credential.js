/**
 * API credentials: keys, tokens and the things that go with them.
 *
 * Modelled on 1Password's API Credential category, which stores a username,
 * the credential itself, a hostname, and validity dates. Two fields are added
 * here because they earned it rather than because 1Password has them.
 *
 * **Environment.** A key is production or it is not, and that single fact
 * changes what a mistake costs. Recording it makes the difference visible in
 * a list, at the moment somebody is deciding whether to paste it somewhere.
 *
 * **Provider detection.** Most issuers put a recognisable prefix on their
 * keys — that is what makes secret scanners work, and it works just as well
 * in your favour. Naming the issuer turns an anonymous blob into "a live
 * Stripe secret key", which is the difference between a string you might
 * paste into a pull request and one you would not.
 *
 * Nothing here talks to any issuer. Detection is prefix matching on a local
 * table; verifying a key would mean sending it somewhere, which is precisely
 * the thing this vault does not do.
 */

/** Credential kinds, following 1Password's `type` field. */
export const CREDENTIAL_TYPES = Object.freeze([
  { id: 'apiKey', label: 'API key' },
  { id: 'bearer', label: 'Bearer token' },
  { id: 'pat', label: 'Personal access token' },
  { id: 'oauth', label: 'OAuth token' },
  { id: 'jwt', label: 'JWT' },
  { id: 'basic', label: 'Basic auth' },
  { id: 'other', label: 'Other' },
]);

/**
 * Where the credential is pointed.
 *
 * Ordered by blast radius, so the most dangerous reads first in a menu and
 * is never the accidental default.
 */
export const ENVIRONMENTS = Object.freeze([
  { id: 'production', label: 'Production', severe: true },
  { id: 'staging', label: 'Staging', severe: false },
  { id: 'development', label: 'Development', severe: false },
  { id: 'test', label: 'Test', severe: false },
  { id: 'unknown', label: 'Not set', severe: false },
]);

/**
 * Known issuer prefixes.
 *
 * Public, documented conventions — the same ones GitHub's own secret scanning
 * matches on. Longest prefix first: `sk-ant-` must beat `sk-`, and
 * `github_pat_` must beat nothing else that starts with `g`.
 *
 * `live` is a tri-state, not a boolean: true means the prefix itself says
 * production, false means it says test, and null means the prefix identifies
 * the issuer but says nothing either way. Collapsing null into false would
 * quietly mark unknown keys as safe.
 */
const PROVIDER_PREFIXES = Object.freeze([
  { prefix: 'github_pat_', provider: 'GitHub', kind: 'Fine-grained PAT', live: null },
  { prefix: 'sk-ant-api', provider: 'Anthropic', kind: 'API key', live: true },
  { prefix: 'sk-ant-', provider: 'Anthropic', kind: 'API key', live: true },
  { prefix: 'dop_v1_', provider: 'DigitalOcean', kind: 'Personal access token', live: true },
  { prefix: 'rk_live_', provider: 'Stripe', kind: 'Restricted key', live: true },
  { prefix: 'rk_test_', provider: 'Stripe', kind: 'Restricted key', live: false },
  { prefix: 'sk_live_', provider: 'Stripe', kind: 'Secret key', live: true },
  { prefix: 'sk_test_', provider: 'Stripe', kind: 'Secret key', live: false },
  { prefix: 'pk_live_', provider: 'Stripe', kind: 'Publishable key', live: true },
  { prefix: 'pk_test_', provider: 'Stripe', kind: 'Publishable key', live: false },
  { prefix: 'shpat_', provider: 'Shopify', kind: 'Access token', live: true },
  { prefix: 'glpat-', provider: 'GitLab', kind: 'Personal access token', live: true },
  { prefix: 'xoxb-', provider: 'Slack', kind: 'Bot token', live: true },
  { prefix: 'xoxp-', provider: 'Slack', kind: 'User token', live: true },
  { prefix: 'xoxa-', provider: 'Slack', kind: 'App token', live: true },
  { prefix: 'xapp-', provider: 'Slack', kind: 'App-level token', live: true },
  { prefix: 'pypi-', provider: 'PyPI', kind: 'Upload token', live: true },
  { prefix: 'figd_', provider: 'Figma', kind: 'Personal access token', live: true },
  { prefix: 'ghp_', provider: 'GitHub', kind: 'Personal access token', live: true },
  { prefix: 'gho_', provider: 'GitHub', kind: 'OAuth token', live: true },
  { prefix: 'ghu_', provider: 'GitHub', kind: 'User-to-server token', live: true },
  { prefix: 'ghs_', provider: 'GitHub', kind: 'Server-to-server token', live: true },
  { prefix: 'ghr_', provider: 'GitHub', kind: 'Refresh token', live: true },
  { prefix: 'npm_', provider: 'npm', kind: 'Access token', live: true },
  { prefix: 'AKIA', provider: 'AWS', kind: 'Access key ID', live: true },
  { prefix: 'ASIA', provider: 'AWS', kind: 'Temporary access key', live: false },
  { prefix: 'AIza', provider: 'Google', kind: 'API key', live: true },
  { prefix: 'SG.', provider: 'SendGrid', kind: 'API key', live: true },
  { prefix: 'hf_', provider: 'Hugging Face', kind: 'Access token', live: true },
  { prefix: 'sk-', provider: 'OpenAI', kind: 'API key', live: true },
]);

/**
 * Identify the issuer from the credential's prefix.
 *
 * @param {string} secret
 * @returns {{provider: string, kind: string, live: boolean|null}|null}
 */
export function detectProvider(secret) {
  if (typeof secret !== 'string') {
    return null;
  }
  const value = secret.trim();
  for (const entry of PROVIDER_PREFIXES) {
    if (value.startsWith(entry.prefix)) {
      return { provider: entry.provider, kind: entry.kind, live: entry.live };
    }
  }
  return null;
}

/**
 * Does the credential itself claim to be a production key?
 *
 * Falls back to the substring convention — `_live_`, `-prod-` — that issuers
 * outside the table above still tend to follow. Used to warn when a key looks
 * like production but the entry says otherwise, which is how a live key ends
 * up filed as a test one and then treated casually.
 *
 * @param {string} secret
 * @returns {boolean}
 */
export function looksLikeProduction(secret) {
  const detected = detectProvider(secret);
  if (detected !== null && detected.live !== null) {
    return detected.live;
  }
  return /(^|[_-])(live|prod|production)([_-]|$)/i.test(String(secret ?? ''));
}

/**
 * Show enough of a credential to recognise it, and not enough to use it.
 *
 * The issuer prefix is kept deliberately: it is the part that identifies the
 * key without being the part that authenticates. The tail is kept because it
 * is how people tell two keys from the same issuer apart — the same reason a
 * card is shown by its last four digits.
 *
 * @param {string} secret
 * @param {{head?: number, tail?: number}} [options]
 * @returns {string}
 */
export function maskCredential(secret, options = {}) {
  const value = typeof secret === 'string' ? secret : '';
  const head = options.head ?? 7;
  const tail = options.tail ?? 4;

  // Too short to reveal any of without revealing most of it.
  if (value.length <= head + tail + 4) {
    return '•'.repeat(Math.max(value.length, 8));
  }
  return `${value.slice(0, head)}${'•'.repeat(8)}${value.slice(-tail)}`;
}

/** Credentials inside this window are reported as expiring rather than valid. */
export const EXPIRING_SOON_DAYS = 30;

const DAY = 86400000;

/**
 * Where a credential sits in its own lifetime.
 *
 * @param {{validFrom?: number|null, expires?: number|null}} credential
 * @param {number} [now]
 * @returns {{state: 'expired'|'expiring'|'valid'|'pending'|'none', days: number|null}}
 */
export function expiryStatus(credential, now = Date.now()) {
  const expires = credential?.expires ?? null;
  const validFrom = credential?.validFrom ?? null;

  if (typeof validFrom === 'number' && validFrom > now) {
    return { state: 'pending', days: Math.ceil((validFrom - now) / DAY) };
  }
  if (typeof expires !== 'number') {
    // Not a fault. Plenty of keys never expire, and reporting that as a
    // problem would train people to ignore the ones that do.
    return { state: 'none', days: null };
  }
  const days = Math.ceil((expires - now) / DAY);
  if (days < 0) {
    return { state: 'expired', days };
  }
  if (days <= EXPIRING_SOON_DAYS) {
    return { state: 'expiring', days };
  }
  return { state: 'valid', days };
}

/**
 * Everything worth saying about one stored credential.
 *
 * @param {object} entry
 * @param {number} [now]
 */
export function describeCredential(entry, now = Date.now()) {
  const secret = entry?.password ?? '';
  const detected = detectProvider(secret);
  const credential = entry?.fields?.credential ?? {};
  const status = expiryStatus(credential, now);
  const declared = credential.environment ?? 'unknown';

  return {
    provider: detected?.provider ?? null,
    kind: detected?.kind ?? null,
    masked: maskCredential(secret),
    environment: declared,
    status,
    // The mismatch worth surfacing: the key says production, the entry does
    // not. That gap is how a live key gets handled like a test one.
    misfiled: looksLikeProduction(secret) && declared !== 'production' && declared !== 'unknown',
  };
}
