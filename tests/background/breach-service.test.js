import { describe, it, expect, vi } from 'vitest';
import { createBreachService } from '../../src/background/breach-service.js';
import { hashForRangeQuery, findSuffix, describeExposure } from '../../src/core/breach-check.js';

/** SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8 */
const PASSWORD_PREFIX = '5BAA6';
const PASSWORD_SUFFIX = '1E4C9B93F3F0682250B6CF8331B7EE68FD8';

function fakeFetch(body, { ok = true, status = 200 } = {}) {
  return vi.fn(async () => ({ ok, status, text: async () => body }));
}

describe('hashForRangeQuery', () => {
  it('splits SHA-1 into a 5-character prefix and the rest', async () => {
    const { prefix, suffix } = await hashForRangeQuery('password');
    expect(prefix).toBe(PASSWORD_PREFIX);
    expect(suffix).toBe(PASSWORD_SUFFIX);
    expect(prefix + suffix).toHaveLength(40);
  });

  it('produces uppercase hex, as the protocol requires', async () => {
    const { prefix, suffix } = await hashForRangeQuery('anything');
    expect(prefix + suffix).toMatch(/^[0-9A-F]{40}$/);
  });
});

describe('findSuffix', () => {
  const body = ['0018A45C4D1DEF81644B54AB7F969B88D65:1', `${PASSWORD_SUFFIX}:9659365`].join('\n');

  it('finds a matching suffix and its count', () => {
    expect(findSuffix(body, PASSWORD_SUFFIX)).toEqual({ breached: true, occurrences: 9659365 });
  });

  it('reports no match when the suffix is absent', () => {
    expect(findSuffix(body, 'F'.repeat(35))).toEqual({ breached: false, occurrences: 0 });
  });

  it('tolerates carriage returns and lowercase', () => {
    expect(findSuffix(`${PASSWORD_SUFFIX.toLowerCase()}:5\r\n`, PASSWORD_SUFFIX).breached).toBe(
      true,
    );
  });

  it('ignores malformed lines rather than throwing', () => {
    expect(findSuffix('garbage\n\nmore garbage', PASSWORD_SUFFIX).breached).toBe(false);
    expect(findSuffix(null, PASSWORD_SUFFIX).breached).toBe(false);
  });
});

describe('createBreachService', () => {
  it('makes no request at all when the feature is off', async () => {
    // The privacy guarantee: no opt-in, no traffic. Not "a request that is
    // then discarded" — no request.
    const fetchImpl = fakeFetch('');
    const service = createBreachService({ fetchImpl });

    const result = await service.check('password', { enabled: false });

    expect(result.status).toBe('disabled');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('treats a missing enabled flag as off', async () => {
    const fetchImpl = fakeFetch('');
    await createBreachService({ fetchImpl }).check('password', {});
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends only the 5-character prefix, never the password or full hash', async () => {
    const fetchImpl = fakeFetch(`${PASSWORD_SUFFIX}:100`);
    await createBreachService({ fetchImpl }).check('password', { enabled: true });

    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${PASSWORD_PREFIX}`);

    // Everything after /range/ must be exactly the 5-character prefix, and
    // nothing else may ride along in a query string or fragment.
    const sent = new URL(url);
    expect(sent.pathname).toBe(`/range/${PASSWORD_PREFIX}`);
    expect(sent.search).toBe('');
    expect(sent.hash).toBe('');
    expect(url).not.toContain(PASSWORD_SUFFIX);
    // Nothing is sent in a body either.
    expect(options.body).toBeUndefined();
    expect(options.method).toBe('GET');
  });

  it('requests padded responses, so size does not leak the answer', async () => {
    const fetchImpl = fakeFetch('');
    await createBreachService({ fetchImpl }).check('password', { enabled: true });
    expect(fetchImpl.mock.calls[0][1].headers['Add-Padding']).toBe('true');
  });

  it('sends no cookies and leaves no cache entry', async () => {
    const fetchImpl = fakeFetch('');
    await createBreachService({ fetchImpl }).check('password', { enabled: true });
    const [, options] = fetchImpl.mock.calls[0];
    expect(options.credentials).toBe('omit');
    expect(options.cache).toBe('no-store');
    expect(options.referrerPolicy).toBe('no-referrer');
  });

  it('reports a breached password with its occurrence count', async () => {
    const fetchImpl = fakeFetch(`${PASSWORD_SUFFIX}:9659365`);
    const result = await createBreachService({ fetchImpl }).check('password', { enabled: true });

    expect(result.status).toBe('ok');
    expect(result.breached).toBe(true);
    expect(result.occurrences).toBe(9659365);
    expect(result.exposure.severity).toBe('critical');
  });

  it('reports a clean password', async () => {
    const fetchImpl = fakeFetch('AAAA1111BBBB2222CCCC3333DDDD4444EEE:3');
    const result = await createBreachService({ fetchImpl }).check('unique-passphrase', {
      enabled: true,
    });

    expect(result.status).toBe('ok');
    expect(result.breached).toBe(false);
    expect(result.exposure.severity).toBe('none');
  });

  it('reports a server error as unavailable, never as safe', async () => {
    // The failure that matters: a user must never be told a breached password
    // is clean because the network was down.
    const fetchImpl = fakeFetch('', { ok: false, status: 503 });
    const result = await createBreachService({ fetchImpl }).check('password', { enabled: true });

    expect(result.status).toBe('unavailable');
    expect(result.breached).toBeUndefined();
  });

  it('reports a network failure as unavailable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const result = await createBreachService({ fetchImpl }).check('password', { enabled: true });

    expect(result.status).toBe('unavailable');
    expect(result.reason).toMatch(/unreachable/);
    expect(result.breached).toBeUndefined();
  });

  it('reports a timeout as unavailable', async () => {
    const fetchImpl = vi.fn(async () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    });
    const result = await createBreachService({ fetchImpl }).check('password', { enabled: true });

    expect(result.status).toBe('unavailable');
    expect(result.reason).toMatch(/timed out/);
  });
});

describe('describeExposure', () => {
  it('scales severity with occurrence count', () => {
    expect(describeExposure(0).severity).toBe('none');
    expect(describeExposure(3).severity).toBe('low');
    expect(describeExposure(500).severity).toBe('high');
    expect(describeExposure(9659365).severity).toBe('critical');
  });

  it('does not claim the user was personally breached', () => {
    // A password appearing in a corpus means it is in attacker wordlists. It
    // does not mean this user's account leaked, and saying so would be wrong.
    const detail = describeExposure(500).detail.toLowerCase();
    expect(detail).not.toMatch(/your account (was|has been) breached/);
    expect(detail).toMatch(/attacker|wordlist|stuffing/);
  });

  it('is honest that a clean result is not proof of safety', () => {
    expect(describeExposure(0).detail).toMatch(/not proof/i);
  });

  it('formats large counts using locale digit grouping', () => {
    // Grouping differs by locale (9,659,365 vs 96,59,365), which is correct
    // behaviour, so assert that grouping happened rather than its exact shape.
    const title = describeExposure(9659365).title;
    expect(title).toContain((9659365).toLocaleString());
    expect(title).not.toContain('9659365');
  });
});
