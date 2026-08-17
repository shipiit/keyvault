import { describe, it, expect, beforeEach } from 'vitest';
import { createFakeChrome } from '../helpers/fake-chrome.js';
import { createVaultService } from '../../src/background/vault-service.js';
import { createAutoLock } from '../../src/background/auto-lock.js';
import { createMessageRouter } from '../../src/background/messages.js';

const FAST = { iterations: 1000 };
const MASTER = 'correct-horse-battery-staple';
const NOW = 1700000000000;

/** A popup or options page: no tab, extension origin. */
const TRUSTED = { url: 'chrome-extension://fake-extension-id/popup.html' };
/** A content script in a web page. */
const PAGE = { tab: { id: 7 }, url: 'https://github.com/login' };
/** A content script on an attacker's site. */
const EVIL = { tab: { id: 8 }, url: 'https://evil.com/' };

describe('message router', () => {
  let chrome;
  let vault;
  let router;

  const send = (type, payload, sender = TRUSTED) => router.handle({ type, payload }, sender);

  beforeEach(async () => {
    chrome = createFakeChrome();
    vault = createVaultService({ chrome, kdfOverrides: FAST });
    const autoLock = createAutoLock({ chrome, vault });
    router = createMessageRouter({ chrome, vault, autoLock, now: () => NOW });
    await vault.create(MASTER);
  });

  async function addGithubEntry(extra = {}) {
    const res = await send('entries/create', {
      fields: {
        title: 'GitHub',
        username: 'rahul@example.com',
        password: 'S3cr3t!',
        urls: ['https://github.com'],
        ...extra,
      },
    });
    return res.data.entry.id;
  }

  describe('the trust boundary', () => {
    it('refuses privileged calls from a content script', async () => {
      for (const type of [
        'vault/status',
        'vault/lock',
        'vault/unlock',
        'entries/list',
        'entries/get',
        'entries/create',
        'entries/delete',
        'entries/totp',
      ]) {
        const res = await router.handle({ type, payload: {} }, PAGE);
        expect(res.ok, `${type} must reject a content script`).toBe(false);
        expect(res.error.name).toBe('NotAuthorizedError');
      }
    });

    it('refuses a sender claiming the extension URL while owning a tab', async () => {
      // A page cannot forge `sender`, but the check must not be satisfiable by
      // URL alone if that ever changes.
      const spoofed = { tab: { id: 9 }, url: 'chrome-extension://fake-extension-id/popup.html' };
      const res = await router.handle({ type: 'entries/list', payload: {} }, spoofed);
      expect(res.ok).toBe(false);
      expect(res.error.name).toBe('NotAuthorizedError');
    });

    it('refuses a sender from another extension', async () => {
      const other = { url: 'chrome-extension://some-other-extension/popup.html' };
      const res = await router.handle({ type: 'entries/list', payload: {} }, other);
      expect(res.ok).toBe(false);
    });

    it('allows the two calls autofill genuinely needs', async () => {
      await addGithubEntry();
      const list = await router.handle(
        { type: 'credentials/forUrl', payload: { url: 'https://github.com/login' } },
        PAGE,
      );
      expect(list.ok).toBe(true);
    });
  });

  describe('credentials/forUrl', () => {
    it('returns matching entries without any secret material', async () => {
      await addGithubEntry();
      const res = await router.handle(
        { type: 'credentials/forUrl', payload: { url: 'https://github.com/login' } },
        PAGE,
      );
      const [entry] = res.data.entries;
      expect(entry.title).toBe('GitHub');
      expect(entry.username).toBe('rahul@example.com');
      expect(entry.hasTotp).toBe(false);
      expect(entry.password).toBeUndefined();
      expect(entry.totp).toBeUndefined();
      expect(entry.notes).toBeUndefined();
      expect(JSON.stringify(res)).not.toContain('S3cr3t!');
    });

    it('returns nothing for an unrelated site', async () => {
      await addGithubEntry();
      const res = await router.handle(
        { type: 'credentials/forUrl', payload: { url: 'https://evil.com' } },
        EVIL,
      );
      expect(res.data.entries).toEqual([]);
    });

    it('never leaks a TOTP secret, only that one exists', async () => {
      await addGithubEntry({
        totp: { secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA-1', digits: 6, period: 30 },
      });
      const res = await router.handle(
        { type: 'credentials/forUrl', payload: { url: 'https://github.com' } },
        PAGE,
      );
      expect(res.data.entries[0].hasTotp).toBe(true);
      expect(JSON.stringify(res)).not.toContain('JBSWY3DPEHPK3PXP');
    });
  });

  describe('credentials/fill', () => {
    it('releases the credential to a matching page', async () => {
      const id = await addGithubEntry();
      const res = await router.handle(
        { type: 'credentials/fill', payload: { id, url: 'https://github.com/login' } },
        PAGE,
      );
      expect(res.data.username).toBe('rahul@example.com');
      expect(res.data.password).toBe('S3cr3t!');
    });

    it('refuses to release a credential to a site it does not belong to', async () => {
      // The core attack: a page names a known entry id and asks for it.
      const id = await addGithubEntry();
      const res = await router.handle(
        { type: 'credentials/fill', payload: { id, url: 'https://evil.com' } },
        EVIL,
      );
      expect(res.ok).toBe(false);
      expect(res.error.name).toBe('NotAuthorizedError');
      expect(JSON.stringify(res)).not.toContain('S3cr3t!');
    });

    it('refuses a lookalike domain', async () => {
      const id = await addGithubEntry();
      const res = await router.handle(
        { type: 'credentials/fill', payload: { id, url: 'https://github.com.evil.co/login' } },
        EVIL,
      );
      expect(res.ok).toBe(false);
    });

    it('refuses a non-web origin', async () => {
      const id = await addGithubEntry();
      const res = await router.handle(
        { type: 'credentials/fill', payload: { id, url: 'javascript:alert(1)' } },
        PAGE,
      );
      expect(res.ok).toBe(false);
      expect(res.error.name).toBe('NotAuthorizedError');
    });

    it('reports autoSubmit as false unless the entry opted in', async () => {
      const id = await addGithubEntry();
      const res = await router.handle(
        { type: 'credentials/fill', payload: { id, url: 'https://github.com' } },
        PAGE,
      );
      expect(res.data.autoSubmit).toBe(false);
    });

    it('reports autoSubmit as true when the entry opted in', async () => {
      const id = await addGithubEntry({ autoSubmit: true });
      const res = await router.handle(
        { type: 'credentials/fill', payload: { id, url: 'https://github.com' } },
        PAGE,
      );
      expect(res.data.autoSubmit).toBe(true);
    });

    it('records last use, so the popup can rank by recency', async () => {
      const id = await addGithubEntry();
      await router.handle(
        { type: 'credentials/fill', payload: { id, url: 'https://github.com' } },
        PAGE,
      );
      const res = await send('entries/get', { id });
      expect(res.data.entry.lastUsedAt).toBe(NOW);
    });
  });

  describe('credentials/save', () => {
    const save = (payload, sender = PAGE) =>
      router.handle({ type: 'credentials/save', payload }, sender);

    it('saves a new credential submitted on a page', async () => {
      const res = await save({
        url: 'https://github.com/login',
        title: 'GitHub',
        username: 'rahul@example.com',
        password: 'S3cr3t!',
      });

      expect(res.ok).toBe(true);
      expect(res.data.saved).toBe(true);
      expect(res.data.updated).toBe(false);

      const list = await send('entries/list');
      expect(list.data.entries[0].title).toBe('GitHub');
    });

    it('stores the entry under the requesting origin, not an attacker-supplied name', async () => {
      // A save under the wrong origin is a fill vulnerability with a delay on
      // it: the entry would later be offered on a site it does not belong to.
      await save({
        url: 'https://github.com/login',
        title: 'Totally Not Evil',
        username: 'u',
        password: 'p',
      });
      const list = await send('entries/list');
      expect(list.data.entries[0].urls).toEqual(['https://github.com']);
    });

    it('refuses to save for a non-web origin', async () => {
      const res = await save({ url: 'javascript:alert(1)', username: 'u', password: 'p' });
      expect(res.ok).toBe(false);
      expect(res.error.name).toBe('NotAuthorizedError');
    });

    it('refuses to save an empty password', async () => {
      const res = await save({ url: 'https://github.com', username: 'u', password: '' });
      expect(res.ok).toBe(false);
    });

    it('never enables auto-submit on a newly saved credential', async () => {
      // Opting a brand-new credential into auto-login without the user ever
      // seeing the choice is exactly what the default guards against.
      await save({ url: 'https://github.com', username: 'u', password: 'p' });
      const list = await send('entries/list');
      expect(list.data.entries[0].autoSubmit).toBe(false);
    });

    it('updates an existing entry when the password changed', async () => {
      await save({ url: 'https://github.com', username: 'u', password: 'old' });
      const res = await save({ url: 'https://github.com', username: 'u', password: 'new' });

      expect(res.data.updated).toBe(true);
      expect((await send('entries/list')).data.entries).toHaveLength(1);
    });

    it('reports no change when the password is identical', async () => {
      await save({ url: 'https://github.com', username: 'u', password: 'same' });
      const res = await save({ url: 'https://github.com', username: 'u', password: 'same' });

      expect(res.data.saved).toBe(false);
      expect(res.data.unchanged).toBe(true);
    });

    it('keeps the old password in history when updating', async () => {
      await save({ url: 'https://github.com', username: 'u', password: 'old' });
      const { data } = await save({ url: 'https://github.com', username: 'u', password: 'new' });
      const entry = (await send('entries/get', { id: data.id })).data.entry;

      expect(entry.password).toBe('new');
      expect(entry.passwordHistory[0].password).toBe('old');
    });

    it('falls back to the hostname when the page supplies no title', async () => {
      await save({ url: 'https://github.com/login', username: 'u', password: 'p' });
      expect((await send('entries/list')).data.entries[0].title).toBe('github.com');
    });

    it('refuses to save while the vault is locked', async () => {
      await send('vault/lock');
      const res = await save({ url: 'https://github.com', username: 'u', password: 'p' });
      expect(res.ok).toBe(false);
      expect(res.error.name).toBe('VaultLockedError');
    });
  });

  describe('locked vault', () => {
    beforeEach(async () => {
      await send('vault/lock');
    });

    it('refuses to list entries', async () => {
      const res = await send('entries/list');
      expect(res.ok).toBe(false);
      expect(res.error.name).toBe('VaultLockedError');
    });

    it('refuses to release credentials to a page', async () => {
      const res = await router.handle(
        { type: 'credentials/forUrl', payload: { url: 'https://github.com' } },
        PAGE,
      );
      expect(res.ok).toBe(false);
      expect(res.error.name).toBe('VaultLockedError');
    });

    it('still reports status', async () => {
      const res = await send('vault/status');
      expect(res.data).toEqual({ initialized: true, locked: true });
    });
  });

  describe('entry operations', () => {
    it('creates, lists, updates and deletes', async () => {
      const id = await addGithubEntry();
      expect((await send('entries/list')).data.entries).toHaveLength(1);

      await send('entries/update', { id, changes: { title: 'GitHub (work)' } });
      expect((await send('entries/get', { id })).data.entry.title).toBe('GitHub (work)');

      await send('entries/delete', { id });
      expect((await send('entries/list')).data.entries).toEqual([]);
    });

    it('filters the list by query', async () => {
      await addGithubEntry();
      await send('entries/create', { fields: { title: 'Bank', urls: ['bank.example'] } });
      expect((await send('entries/list', { query: 'git' })).data.entries).toHaveLength(1);
    });

    it('generates a TOTP code', async () => {
      const id = await addGithubEntry({
        totp: { secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA-1', digits: 6, period: 30 },
      });
      const res = await send('entries/totp', { id });
      expect(res.data.code).toMatch(/^\d{6}$/);
      expect(res.data.remainingSeconds).toBeGreaterThan(0);
      expect(res.data.remainingSeconds).toBeLessThanOrEqual(30);
    });

    it('reports a missing entry as an error rather than crashing', async () => {
      const res = await send('entries/get', { id: 'nope' });
      expect(res.ok).toBe(false);
      expect(res.error.message).toMatch(/not found/);
    });
  });

  describe('malformed input', () => {
    it('rejects an unknown message type', async () => {
      const res = await send('nonsense/type');
      expect(res.ok).toBe(false);
      expect(res.error.message).toMatch(/unknown message type/);
    });

    it('rejects a non-object message', async () => {
      expect((await router.handle(null, TRUSTED)).ok).toBe(false);
      expect((await router.handle('hello', TRUSTED)).ok).toBe(false);
    });

    it('never throws across the boundary, always returns a result', async () => {
      const res = await send('entries/create', { fields: { title: '' } });
      expect(res.ok).toBe(false);
      expect(res.error.name).toBe('RangeError');
    });
  });
});
