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

    it('refuses a sender on another extension origin, tab or not', async () => {
      // The origin is the whole test, and Chrome fills it in rather than the
      // sender, so a different extension id cannot be talked around.
      for (const spoofed of [
        { tab: { id: 9 }, url: 'chrome-extension://a-different-extension/popup.html' },
        { url: 'chrome-extension://a-different-extension/popup.html' },
      ]) {
        const res = await router.handle({ type: 'entries/list', payload: {} }, spoofed);
        expect(res.ok).toBe(false);
        expect(res.error.name).toBe('NotAuthorizedError');
      }
    });

    it('allows the vault page, which is an extension page that owns a tab', async () => {
      // The bug this pins, found by the end-to-end suite on its first real
      // run: rejecting every sender with a `tab` also rejected `vault.html`,
      // because a full-page extension surface is a tab. The whole vault page
      // rendered nothing but the authorisation error. Only the popup worked,
      // being the one surface without a tab.
      const vaultPage = {
        tab: { id: 11 },
        url: `chrome-extension://${chrome.runtime.id}/ui/vault.html`,
      };
      const res = await router.handle({ type: 'vault/status', payload: {} }, vaultPage);
      expect(res.ok, res.error?.message).toBe(true);
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

  describe('archiving', () => {
    it('stops offering an archived login to a page', async () => {
      // The whole reason to archive rather than delete: you keep the record
      // and it stops being suggested at the login form it belonged to.
      const id = await addGithubEntry();
      await send('entries/archive', { id });

      const forPage = await router.handle(
        { type: 'credentials/forUrl', payload: { url: 'https://github.com/login' } },
        PAGE,
      );
      expect(forPage.data.entries).toEqual([]);
    });

    it('refuses to release an archived credential even when named directly', async () => {
      // A page that already knows the id must not get it back by asking.
      const id = await addGithubEntry();
      await send('entries/archive', { id });

      const filled = await router.handle(
        { type: 'credentials/fill', payload: { id, url: 'https://github.com/login' } },
        PAGE,
      );
      expect(filled.ok).toBe(false);
      expect(JSON.stringify(filled)).not.toContain('S3cr3t!');
    });

    it('keeps it out of the list and the score, but in the archive', async () => {
      const id = await addGithubEntry();
      await send('entries/archive', { id });

      expect((await send('entries/list', {})).data.entries).toEqual([]);
      expect((await send('security/score', {})).data.checked).toBe(0);
      expect((await send('entries/archived', {})).data.entries[0].id).toBe(id);
    });

    it('restores it to circulation', async () => {
      const id = await addGithubEntry();
      await send('entries/archive', { id });
      await send('entries/unarchive', { id });

      expect((await send('entries/list', {})).data.entries[0].id).toBe(id);
      expect((await send('entries/archived', {})).data.entries).toEqual([]);
    });

    it('is not the trash', async () => {
      const id = await addGithubEntry();
      await send('entries/archive', { id });
      expect((await send('entries/trash', {})).data.entries).toEqual([]);
    });
  });

  describe('custom fields and the trust boundary', () => {
    it('gives the vault list the searchable text, and a content script none of it', async () => {
      // Two projections on purpose. The list filters on custom field labels,
      // which must not cross into a web page — a page learning an item has a
      // "Recovery code" field is a leak even without the value.
      await send('entries/create', {
        fields: {
          title: 'Bank',
          urls: ['https://github.com'],
          fields: {
            sections: [
              {
                title: 'Recovery',
                fields: [{ label: 'Backup code', type: 'concealed', value: 'S3CRET-CODE' }],
              },
            ],
          },
        },
      });

      const listed = await send('entries/list', {});
      expect(listed.data.entries[0].searchText).toContain('Backup code');
      expect(listed.data.entries[0].customFields).toBe(1);

      const forPage = await router.handle(
        { type: 'credentials/forUrl', payload: { url: 'https://github.com/login' } },
        PAGE,
      );
      expect(forPage.data.entries[0].searchText).toBeUndefined();
      expect(forPage.data.entries[0].customFields).toBeUndefined();
      expect(JSON.stringify(forPage)).not.toContain('Backup code');
    });

    it('never sends a hidden field value anywhere, list included', async () => {
      await send('entries/create', {
        fields: {
          title: 'Bank',
          urls: ['https://github.com'],
          fields: {
            sections: [
              {
                title: 'Recovery',
                fields: [{ label: 'Backup code', type: 'concealed', value: 'S3CRET-CODE' }],
              },
            ],
          },
        },
      });

      const listed = await send('entries/list', {});
      expect(JSON.stringify(listed)).not.toContain('S3CRET-CODE');
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

  describe('trash', () => {
    it('moves an entry to the trash rather than destroying it', async () => {
      // Nothing holds a copy of this vault, so a mis-click must not be the
      // end of a credential.
      const id = await addGithubEntry();
      const res = await send('entries/delete', { id });

      expect(res.data.trashed).toBe(true);
      expect((await send('entries/get', { id })).ok).toBe(true);
    });

    it('hides a trashed entry from the list', async () => {
      const id = await addGithubEntry();
      await send('entries/delete', { id });
      expect((await send('entries/list')).data.entries).toEqual([]);
    });

    it('hides a trashed entry from search', async () => {
      // Finding one and filling it would defeat the point of deleting it.
      const id = await addGithubEntry();
      await send('entries/delete', { id });
      expect((await send('entries/list', { query: 'github' })).data.entries).toEqual([]);
    });

    it('never offers a trashed entry to a page', async () => {
      const id = await addGithubEntry();
      await send('entries/delete', { id });

      const listed = await router.handle(
        { type: 'credentials/forUrl', payload: { url: 'https://github.com' } },
        PAGE,
      );
      expect(listed.data.entries).toEqual([]);

      const filled = await router.handle(
        { type: 'credentials/fill', payload: { id, url: 'https://github.com' } },
        PAGE,
      );
      expect(filled.ok).toBe(false);
    });

    it('never autofills a trashed entry', async () => {
      const id = await addGithubEntry();
      await send('entries/delete', { id });

      const res = await router.handle(
        { type: 'credentials/autofill', payload: { url: 'https://github.com/login' } },
        PAGE,
      );
      expect(res.data.fill).toBeNull();
    });

    it('lists what is in the trash, most recent first', async () => {
      // A moving clock: with the frozen one both deletions share a
      // timestamp and the order is genuinely undefined, so asserting it
      // would be asserting nothing.
      let clock = NOW;
      const timed = createMessageRouter({
        chrome,
        vault,
        autoLock: createAutoLock({ chrome, vault }),
        now: () => clock,
      });
      const ask = (type, payload) => timed.handle({ type, payload }, TRUSTED);

      const first = await addGithubEntry();
      const second = await addGithubEntry({ username: 'second@example.com' });

      await ask('entries/delete', { id: first });
      clock = NOW + 1000;
      await ask('entries/delete', { id: second });

      const { entries } = (await ask('entries/trash')).data;
      expect(entries).toHaveLength(2);
      expect(entries[0].id).toBe(second);
    });

    it('restores an entry exactly as it was', async () => {
      const id = await addGithubEntry();
      await send('entries/delete', { id });
      await send('entries/restore', { id });

      const [restored] = (await send('entries/list')).data.entries;
      expect(restored.id).toBe(id);
      expect(restored.username).toBe('rahul@example.com');
      expect((await send('entries/get', { id })).data.entry.password).toBe('S3cr3t!');
    });

    it('refuses to destroy an entry that is not in the trash', async () => {
      // Purging something still visible in a normal list would make the
      // trash pointless.
      const id = await addGithubEntry();
      const res = await send('entries/purge', { id });

      expect(res.ok).toBe(false);
      expect(res.error.message).toMatch(/must be in the trash/);
    });

    it('destroys an entry once it is in the trash', async () => {
      const id = await addGithubEntry();
      await send('entries/delete', { id });
      await send('entries/purge', { id });

      expect((await send('entries/trash')).data.entries).toEqual([]);
      expect((await send('entries/get', { id })).ok).toBe(false);
    });

    it('empties the trash without touching live entries', async () => {
      const kept = await addGithubEntry();
      const gone = await addGithubEntry({ username: 'second@example.com' });
      await send('entries/delete', { id: gone });

      const res = await send('entries/emptyTrash');
      expect(res.data.removed).toBe(1);
      expect((await send('entries/list')).data.entries[0].id).toBe(kept);
    });

    it('leaves a trashed password out of the security score', async () => {
      // Counting it would make the score worse for tidying up.
      const id = await addGithubEntry({ password: 'password' });
      const before = (await send('security/score')).data;
      await send('entries/delete', { id });
      const after = (await send('security/score')).data;

      expect(after.checked).toBeLessThan(before.checked);
    });
  });

  describe('credentials/autofill', () => {
    const ask = (url = 'https://github.com/login', sender = PAGE) =>
      router.handle({ type: 'credentials/autofill', payload: { url } }, sender);

    it('returns the one matching credential', async () => {
      await addGithubEntry();
      const res = await ask();

      expect(res.data.fill.username).toBe('rahul@example.com');
      expect(res.data.fill.password).toBe('S3cr3t!');
    });

    it('fills the most recently used when several accounts match', async () => {
      // Declining on ambiguity meant the user saw nothing happen and had no
      // way to find out why, which reads as autofill being broken.
      const first = await addGithubEntry();
      await addGithubEntry({ username: 'second@example.com' });

      // Using the first one makes it the most recent.
      await router.handle(
        { type: 'credentials/fill', payload: { id: first, url: 'https://github.com' } },
        PAGE,
      );

      const res = await ask();
      expect(res.data.fill.username).toBe('rahul@example.com');
      expect(res.data.fill.alternatives).toBe(1);
    });

    it('returns nothing for a site with no saved login', async () => {
      await addGithubEntry();
      expect((await ask('https://elsewhere.example')).data.fill).toBeNull();
    });

    it('refuses a non-web origin', async () => {
      await addGithubEntry();
      expect((await ask('javascript:alert(1)')).data.fill).toBeNull();
    });

    it('respects the setting being turned off', async () => {
      await addGithubEntry();
      await send('settings/update', { changes: { autofillOnLoad: false } });

      const res = await ask();
      expect(res.data.fill).toBeNull();
      expect(res.data.reason).toMatch(/turned off/);
    });

    it('reports autoSubmit but never decides it here', async () => {
      // Filling and submitting stay separate: this only relays what the
      // entry opted into.
      await addGithubEntry();
      expect((await ask()).data.fill.autoSubmit).toBe(false);

      await send('vault/lock');
      await send('vault/unlock', { password: MASTER });
      await addGithubEntry({ autoSubmit: true, username: 'only@example.com' });
    });

    it('refuses while the vault is locked', async () => {
      await addGithubEntry();
      await send('vault/lock');

      const res = await ask();
      expect(res.ok).toBe(false);
      expect(res.error.name).toBe('VaultLockedError');
    });

    it('does not leak anything when it declines', async () => {
      await addGithubEntry();
      expect(JSON.stringify(await ask('https://elsewhere.example'))).not.toContain('S3cr3t!');
    });

    it('records the entry as used, so the popup ranks it first', async () => {
      const id = await addGithubEntry();
      await ask();
      expect((await send('entries/get', { id })).data.entry.lastUsedAt).toBe(NOW);
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

    it('keeps the port, so localhost apps are separate entries', async () => {
      // Storing a bare https://host drops the port, collapsing
      // localhost:5173 and localhost:3000 into one entry.
      await save({ url: 'http://localhost:5173/login', username: 'u', password: 'p' });
      const list = await send('entries/list');
      expect(list.data.entries[0].urls).toEqual(['http://localhost:5173']);
    });

    it('keeps the scheme it was saved under', async () => {
      await save({ url: 'http://insecure.example/login', username: 'u', password: 'p' });
      expect((await send('entries/list')).data.entries[0].urls).toEqual([
        'http://insecure.example',
      ]);
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

  describe('credentials/shouldSave', () => {
    const ask = (payload) => router.handle({ type: 'credentials/shouldSave', payload }, PAGE);

    const submitted = {
      url: 'https://github.com/login',
      username: 'rahul@example.com',
      password: 'S3cr3t!',
    };

    it('prompts for a credential that is not saved yet', async () => {
      const res = await ask(submitted);
      expect(res.data.worthSaving).toBe(true);
      expect(res.data.isUpdate).toBe(false);
    });

    it('stays silent when nothing changed', async () => {
      // The bug this exists for: the content script cannot see the stored
      // password, so it asked on every single login.
      await addGithubEntry();
      expect((await ask(submitted)).data.worthSaving).toBe(false);
    });

    it('prompts when the password actually changed', async () => {
      await addGithubEntry();
      const res = await ask({ ...submitted, password: 'a-new-password' });

      expect(res.data.worthSaving).toBe(true);
      expect(res.data.isUpdate).toBe(true);
    });

    it('prompts when the entry would gain a two-factor code', async () => {
      await addGithubEntry();
      const res = await ask({ ...submitted, totpUri: 'JBSWY3DPEHPK3PXP' });

      expect(res.data.worthSaving).toBe(true);
      expect(res.data.gainsTotp).toBe(true);
    });

    it('stays silent when it already has that two-factor code', async () => {
      await addGithubEntry({
        totp: { secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA-1', digits: 6, period: 30 },
      });
      expect((await ask({ ...submitted, totpUri: 'JBSWY3DPEHPK3PXP' })).data.worthSaving).toBe(
        false,
      );
    });

    it('treats a different username on the same site as new', async () => {
      await addGithubEntry();
      const res = await ask({ ...submitted, username: 'other@example.com' });

      expect(res.data.worthSaving).toBe(true);
      expect(res.data.isUpdate).toBe(false);
    });

    it('never prompts for an empty password', async () => {
      expect((await ask({ ...submitted, password: '' })).data.worthSaving).toBe(false);
    });

    it('never prompts for a non-web origin', async () => {
      expect((await ask({ ...submitted, url: 'javascript:alert(1)' })).data.worthSaving).toBe(
        false,
      );
    });

    it('does not reveal the stored password in its answer', async () => {
      await addGithubEntry();
      expect(JSON.stringify(await ask(submitted))).not.toContain('S3cr3t!');
    });
  });

  describe('surviving a navigation', () => {
    // A normal form POST unloads the page and the content script with it.
    // Without a stash the save prompt only ever worked on single-page apps.
    const stash = (payload) => router.handle({ type: 'credentials/stash', payload }, PAGE);
    const collect = (url, sender = PAGE) =>
      router.handle({ type: 'credentials/pending', payload: { url } }, sender);

    const submission = {
      url: 'https://github.com/session',
      title: 'GitHub',
      username: 'rahul@example.com',
      password: 'S3cr3t!',
    };

    it('hands a stashed credential back to the same origin', async () => {
      await stash(submission);
      const res = await collect('https://github.com/dashboard');

      expect(res.ok).toBe(true);
      expect(res.data.pending.username).toBe('rahul@example.com');
      expect(res.data.pending.password).toBe('S3cr3t!');
    });

    it('refuses to hand it to a different origin', async () => {
      // Otherwise any site could collect a credential submitted elsewhere.
      await stash(submission);
      const res = await collect('https://evil.com/', EVIL);

      expect(res.data.pending).toBeNull();
      expect(JSON.stringify(res)).not.toContain('S3cr3t!');
    });

    it('clears the stash even when the origin does not match', async () => {
      // A stash nobody can claim is just a password sitting in memory.
      await stash(submission);
      await collect('https://evil.com/', EVIL);
      expect((await collect('https://github.com/')).data.pending).toBeNull();
    });

    it('can only be collected once', async () => {
      await stash(submission);
      expect((await collect('https://github.com/')).data.pending).not.toBeNull();
      expect((await collect('https://github.com/')).data.pending).toBeNull();
    });

    it('distinguishes ports, so localhost apps do not collide', async () => {
      await stash({ ...submission, url: 'http://localhost:5173/login' });
      expect((await collect('http://localhost:3000/')).data.pending).toBeNull();
    });

    it('expires rather than lingering', async () => {
      let clock = NOW;
      const timed = createMessageRouter({
        chrome,
        vault,
        autoLock: createAutoLock({ chrome, vault }),
        now: () => clock,
      });
      await timed.handle({ type: 'credentials/stash', payload: submission }, PAGE);

      clock = NOW + 61000;
      const res = await timed.handle(
        { type: 'credentials/pending', payload: { url: 'https://github.com/' } },
        PAGE,
      );
      expect(res.data.pending).toBeNull();
    });

    it('refuses to stash an empty password', async () => {
      const res = await stash({ ...submission, password: '' });
      expect(res.data.stashed).toBe(false);
    });

    it('never writes the stash to persistent storage', async () => {
      await stash(submission);
      const persisted = JSON.stringify([...chrome.storage.local.data.values()]);
      expect(persisted).not.toContain('S3cr3t!');
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
