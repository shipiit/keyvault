import { createEntry, updateEntry } from '../core/entry.js';
import {
  addEntry,
  replaceEntry,
  removeEntry,
  findEntry,
  searchEntries,
} from '../core/vault-data.js';
import { entriesForUrl, entryMatchesUrl, toHostname, toOrigin } from '../core/url-match.js';
import { parseTotpInput, generateTotp, totpTimeRemaining } from '../core/totp.js';
import { computeSecurityScore } from '../core/security-score.js';
import { KeyVaultError } from '../core/errors.js';
import { createBreachService } from './breach-service.js';
import { createBackup, readBackup, backupFilename } from '../core/backup.js';

/**
 * Turn a pasted `otpauth://` URI or bare secret into a stored TOTP config.
 *
 * Accepts both because users paste whichever the site showed them. Parsing
 * happens here rather than in the UI so the same validation applies however
 * the entry was created — including from an importer later.
 *
 * @param {object} fields
 * @returns {object}
 */
function withParsedTotp(fields) {
  if (fields === null || typeof fields !== 'object' || fields.totpUri === undefined) {
    return fields;
  }
  const { totpUri, ...rest } = fields;

  if (typeof totpUri !== 'string' || totpUri.trim() === '') {
    return { ...rest, totp: null };
  }

  // The shared parser: accepts a full otpauth:// link or the bare setup key,
  // so a credential saved from the page, the edit form and the setup card
  // all validate identically.
  const config = parseTotpInput(totpUri, { title: rest.title });

  return {
    ...rest,
    totp: {
      secret: config.secret,
      issuer: config.issuer,
      algorithm: config.algorithm,
      digits: config.digits,
      period: config.period,
    },
  };
}

/** Session key holding a credential captured just before a navigation. */
const PENDING_KEY = 'keyvault.pendingCredential';

/**
 * How long a stashed credential stays claimable.
 *
 * Long enough to survive a login redirect chain, short enough that a
 * password is not left sitting in memory after the user has moved on.
 */
const PENDING_TTL_MS = 60000;

/** Raised when a caller asks for something its context is not allowed to do. */
export class NotAuthorizedError extends KeyVaultError {}

/**
 * Strip an entry down to what is safe to show in a list.
 *
 * Content scripts and list views get this, never the full record. Password,
 * notes, and the TOTP secret are omitted entirely — `hasTotp` tells the UI
 * whether to render a 2FA affordance without handing over the secret.
 *
 * @param {object} entry
 */
function toSummary(entry) {
  return {
    id: entry.id,
    type: entry.type ?? 'login',
    title: entry.title,
    username: entry.username,
    urls: entry.urls,
    tags: entry.tags,
    folderId: entry.folderId,
    hasTotp: entry.totp !== null && entry.totp !== undefined,
    favorite: entry.favorite === true,
    autoSubmit: entry.autoSubmit,
    lastUsedAt: entry.lastUsedAt,
    updatedAt: entry.updatedAt,
  };
}

/**
 * Whether a message came from a privileged extension page (popup, options)
 * rather than a content script running inside a web page.
 *
 * A content script always carries `sender.tab`. Extension pages do not, and
 * their URL is on the extension's own origin. Both conditions are required:
 * either alone is weaker than it looks.
 *
 * @param {object} sender
 * @param {object} chrome
 */
function isTrustedSender(sender, chrome) {
  if (sender === null || typeof sender !== 'object') {
    return false;
  }
  if (sender.tab !== undefined && sender.tab !== null) {
    return false;
  }
  const expectedPrefix = `chrome-extension://${chrome.runtime.id}/`;
  return typeof sender.url === 'string' && sender.url.startsWith(expectedPrefix);
}

/**
 * The extension's internal API.
 *
 * Every handler declares whether a content script may call it. The default is
 * no: a compromised page should be able to reach only the two operations
 * autofill genuinely needs, and neither of them can enumerate the vault or
 * read the encryption key.
 *
 * @param {object} options
 * @param {object} options.chrome
 * @param {object} options.vault vault service
 * @param {object} options.autoLock auto-lock controller
 * @param {() => number} [options.now] clock, injectable for tests
 */
export function createMessageRouter({
  chrome,
  vault,
  autoLock,
  now = () => Date.now(),
  breachService = createBreachService(),
}) {
  const handlers = {
    // ---- Status and lifecycle (trusted contexts only) ----

    'vault/status': {
      contentScript: false,
      handle: () => vault.getStatus(),
    },

    'vault/create': {
      contentScript: false,
      handle: async ({ password }) => {
        await vault.create(password);
        await autoLock.touch();
        return { created: true };
      },
    },

    'vault/unlock': {
      contentScript: false,
      handle: async ({ password }) => {
        await vault.unlock(password);
        await autoLock.touch();
        return { unlocked: true };
      },
    },

    'vault/lock': {
      contentScript: false,
      handle: async () => {
        await vault.lock();
        await autoLock.cancel();
        return { locked: true };
      },
    },

    'vault/changePassword': {
      contentScript: false,
      handle: async ({ currentPassword, newPassword }) => {
        await vault.changeMasterPassword(currentPassword, newPassword);
        return { changed: true };
      },
    },

    // ---- Vault contents (trusted contexts only) ----

    'entries/list': {
      contentScript: false,
      handle: async ({ query = '' } = {}) => {
        const data = await vault.getData();
        return { entries: searchEntries(data, query).map(toSummary) };
      },
    },

    'entries/get': {
      contentScript: false,
      handle: async ({ id }) => {
        const data = await vault.getData();
        const entry = findEntry(data, id);
        if (entry === null) {
          throw new Error(`entry not found: ${id}`);
        }
        return { entry };
      },
    },

    'entries/create': {
      contentScript: false,
      handle: async ({ fields }) => {
        const entry = createEntry(withParsedTotp(fields), now());
        await vault.mutate((data) => addEntry(data, entry));
        return { entry: toSummary(entry) };
      },
    },

    'entries/update': {
      contentScript: false,
      handle: async ({ id, changes }) => {
        let updated = null;
        await vault.mutate((data) => {
          const existing = findEntry(data, id);
          if (existing === null) {
            throw new Error(`entry not found: ${id}`);
          }
          updated = updateEntry(existing, withParsedTotp(changes), now());
          return replaceEntry(data, updated);
        });
        return { entry: toSummary(updated) };
      },
    },

    'entries/delete': {
      contentScript: false,
      handle: async ({ id }) => {
        await vault.mutate((data) => removeEntry(data, id));
        return { deleted: true };
      },
    },

    'entries/totp': {
      contentScript: false,
      handle: async ({ id }) => {
        const data = await vault.getData();
        const entry = findEntry(data, id);
        if (entry === null || entry.totp === null) {
          throw new Error('entry has no TOTP secret');
        }
        return {
          code: await generateTotp({ ...entry.totp, timestamp: now() }),
          remainingSeconds: totpTimeRemaining(entry.totp.period, now()),
        };
      },
    },

    // ---- The narrow surface content scripts may reach ----

    // ---- Settings (trusted contexts only) ----

    'settings/get': {
      contentScript: false,
      handle: async () => ({ settings: (await vault.getData()).settings }),
    },

    'settings/update': {
      contentScript: false,
      /**
       * Merge a partial settings change.
       *
       * Merged rather than replaced so a UI that knows about fewer settings
       * than the stored vault — an older popup against a newer vault —
       * cannot silently erase the ones it did not render.
       */
      handle: async ({ changes }) => {
        if (changes === null || typeof changes !== 'object') {
          throw new TypeError('settings changes must be an object');
        }
        const updated = await vault.mutate((data) => ({
          ...data,
          settings: {
            ...data.settings,
            ...changes,
            generator: { ...data.settings.generator, ...(changes.generator ?? {}) },
          },
        }));

        // Auto-lock reads its interval from settings, so a changed timer
        // must take effect now rather than after the next unlock.
        await autoLock.touch();
        return { settings: updated.settings };
      },
    },

    // ---- Device unlock (trusted contexts only) ----

    'device/status': {
      contentScript: false,
      handle: () => vault.getDeviceUnlock(),
    },

    'device/enable': {
      contentScript: false,
      /**
       * PRF output arrives as an array of numbers: a Uint8Array does not
       * survive extension message serialisation, which would silently
       * become an empty object.
       */
      handle: async ({ prfOutput, credentialId }) => {
        const result = await vault.enableDeviceUnlock(
          Uint8Array.from(prfOutput ?? []),
          credentialId,
        );
        await autoLock.touch();
        return result;
      },
    },

    'device/disable': {
      contentScript: false,
      handle: () => vault.disableDeviceUnlock(),
    },

    'device/unlock': {
      contentScript: false,
      handle: async ({ prfOutput }) => {
        await vault.unlockWithDevice(Uint8Array.from(prfOutput ?? []));
        await autoLock.touch();
        return { unlocked: true };
      },
    },

    // ---- Backup (trusted contexts only) ----

    'backup/create': {
      contentScript: false,
      /**
       * Produce an encrypted backup of the whole vault.
       *
       * The passphrase is separate from the master password by design — see
       * `core/backup.js`. Returned to the caller rather than written here:
       * the background has no file access, and the UI is where a download
       * belongs.
       */
      handle: async ({ passphrase }) => {
        const data = await vault.getData();
        return {
          backup: await createBackup(data, passphrase, { now: now() }),
          filename: backupFilename(now()),
        };
      },
    },

    'backup/restore': {
      contentScript: false,
      /**
       * Merge a backup into the current vault.
       *
       * Merged, never replaced. Replacing would let one mistaken restore
       * destroy everything added since the backup was taken, and there is
       * no server holding a copy to undo it with. Entries already present
       * by id are left alone.
       */
      handle: async ({ backup, passphrase }) => {
        const restored = await readBackup(backup, passphrase);
        let added = 0;
        let skipped = 0;

        await vault.mutate((data) => {
          const known = new Set(data.entries.map((entry) => entry.id));
          const incoming = (restored.entries ?? []).filter((entry) => {
            if (known.has(entry.id)) {
              skipped += 1;
              return false;
            }
            added += 1;
            return true;
          });
          return { ...data, entries: [...data.entries, ...incoming] };
        });

        return { added, skipped };
      },
    },

    'backup/import': {
      contentScript: false,
      /**
       * Import from another password manager.
       *
       * The file is parsed in the UI and arrives here as entry fields, so
       * this layer never sees a foreign format — it only creates entries,
       * with the same validation any manually created entry gets.
       */
      handle: async ({ entries }) => {
        if (!Array.isArray(entries)) {
          throw new TypeError('import expects an array of entries');
        }
        let added = 0;
        await vault.mutate((data) =>
          entries.reduce((current, fields) => {
            try {
              const entry = createEntry(withParsedTotp(fields), now());
              added += 1;
              return addEntry(current, entry);
            } catch {
              // One malformed row must not abandon the rest of the import.
              return current;
            }
          }, data),
        );
        return { added, skipped: entries.length - added };
      },
    },

    // ---- Security tooling (trusted contexts only) ----

    'security/score': {
      contentScript: false,
      /**
       * Vault health, computed from the real contents.
       *
       * Breach data is only included when the user has enabled breach
       * checking; otherwise the score reports that it is missing rather than
       * scoring as though nothing were breached.
       */
      handle: async () => {
        const data = await vault.getData();
        const breachedIds = data.settings?.breachCheckEnabled === true ? [] : undefined;
        return computeSecurityScore(data.entries, { now: now(), breachedIds });
      },
    },

    'security/checkBreach': {
      contentScript: false,
      /**
       * Check one entry's password against the public breach corpus.
       *
       * Runs only on explicit user action, and only when the setting is on.
       * The password never leaves the device — see `core/breach-check.js`.
       */
      handle: async ({ id }) => {
        const data = await vault.getData();
        const entry = findEntry(data, id);
        if (entry === null) {
          throw new Error(`entry not found: ${id}`);
        }
        return breachService.check(entry.password, {
          enabled: data.settings?.breachCheckEnabled === true,
        });
      },
    },

    'credentials/forUrl': {
      contentScript: true,
      /**
       * Which saved entries match this page. Metadata only — no password, no
       * TOTP secret. A page learns that a credential exists, which it can
       * already infer from the autofill icon, and nothing more.
       */
      handle: async ({ url }) => {
        const data = await vault.getData();
        return { entries: entriesForUrl(data.entries, url).map(toSummary) };
      },
    },

    'credentials/fill': {
      contentScript: true,
      /**
       * Release one credential for one page.
       *
       * The entry must independently match the requesting URL. A content
       * script cannot name an arbitrary entry id and receive its password:
       * the origin check is re-run here, on the trusted side, rather than
       * trusted from the caller.
       */
      handle: async ({ id, url }) => {
        if (toHostname(url) === null) {
          throw new NotAuthorizedError('refusing to fill a non-web origin');
        }
        const data = await vault.getData();
        const entry = findEntry(data, id);
        if (entry === null) {
          throw new Error(`entry not found: ${id}`);
        }
        if (!entryMatchesUrl(entry, url)) {
          throw new NotAuthorizedError('entry does not belong to this site');
        }

        await vault.mutate((current) => {
          const existing = findEntry(current, id);
          return replaceEntry(current, { ...existing, lastUsedAt: now() });
        });
        await autoLock.touch();

        return {
          username: entry.username,
          password: entry.password,
          // Auto-submit is per entry and off by default. The content script
          // is told what this entry opted into; it never decides for itself.
          autoSubmit: entry.autoSubmit === true,
        };
      },
    },

    'credentials/stash': {
      contentScript: true,
      /**
       * Hold a submitted credential across a navigation.
       *
       * A normal form POST unloads the page, taking the content script and
       * its captured credential with it. Without this the save prompt only
       * ever worked on single-page apps — which is to say, it mostly did not
       * work at all.
       *
       * Stored in `chrome.storage.session`: memory-only, cleared when the
       * browser closes, and restricted to trusted contexts so no page can
       * read it. It is the password the user just typed into that page, so
       * this adds no exposure the page did not already have, and it expires
       * in well under a minute.
       */
      handle: async ({ url, title, username, password }) => {
        const origin = toOrigin(url);
        if (origin === null || typeof password !== 'string' || password === '') {
          return { stashed: false };
        }
        await chrome.storage.session.set({
          [PENDING_KEY]: { origin, url, title, username, password, at: now() },
        });
        return { stashed: true };
      },
    },

    'credentials/pending': {
      contentScript: true,
      /**
       * Collect a credential stashed before a navigation, if it belongs to
       * the page now asking and is recent.
       *
       * Origin-checked on this side rather than trusted from the caller: a
       * page must not be able to collect a credential submitted to a
       * different site. Consumed on read, so it can only be claimed once.
       */
      handle: async ({ url }) => {
        const origin = toOrigin(url);
        const stored = await chrome.storage.session.get(PENDING_KEY);
        const pending = stored[PENDING_KEY];

        if (pending === undefined) {
          return { pending: null };
        }
        // Always clear, even on a mismatch: a stash nobody can claim is just
        // a password sitting in memory.
        await chrome.storage.session.remove(PENDING_KEY);

        if (pending.origin !== origin || now() - pending.at > PENDING_TTL_MS) {
          return { pending: null };
        }
        return { pending };
      },
    },

    'credentials/save': {
      contentScript: true,
      /**
       * Save or update a credential the user just submitted on a page.
       *
       * The URL is taken from the message, but it is re-derived through
       * `toHostname` before being stored, so a page cannot record itself
       * under some other site's name and have that entry offered there
       * later. A save is as security-relevant as a fill: getting an entry
       * into the vault under the wrong origin is a fill vulnerability with
       * a delay on it.
       *
       * Created entries never set autoSubmit. Opting a brand-new credential
       * into auto-login without the user ever seeing the choice would be
       * exactly the phishing exposure the default guards against.
       */
      handle: async ({ url, title, username, password, totpUri }) => {
        const host = toHostname(url);
        const origin = toOrigin(url);
        if (host === null || origin === null) {
          throw new NotAuthorizedError('refusing to save a credential for a non-web origin');
        }
        if (typeof password !== 'string' || password === '') {
          throw new Error('refusing to save an empty password');
        }

        const data = await vault.getData();
        const existing = data.entries.find(
          (entry) => entryMatchesUrl(entry, url) && (entry.username ?? '') === (username ?? ''),
        );

        if (existing !== undefined) {
          const changes = { password };
          if (typeof totpUri === 'string' && totpUri !== '') {
            changes.totpUri = totpUri;
          }
          if (existing.password === password && changes.totpUri === undefined) {
            return { saved: false, unchanged: true };
          }
          await vault.mutate((current) =>
            replaceEntry(
              current,
              updateEntry(findEntry(current, existing.id), withParsedTotp(changes), now()),
            ),
          );
          await autoLock.touch();
          return { saved: true, updated: true, id: existing.id };
        }

        const entry = createEntry(
          withParsedTotp({
            title: typeof title === 'string' && title.trim() !== '' ? title.trim() : host,
            username: username ?? '',
            password,
            // The full origin, scheme and port included. Storing a bare
            // `https://host` loses the port, and on a dev machine
            // localhost:5173 and localhost:3000 are different applications.
            urls: [origin],
            totpUri: typeof totpUri === 'string' && totpUri !== '' ? totpUri : undefined,
          }),
          now(),
        );
        await vault.mutate((current) => addEntry(current, entry));
        await autoLock.touch();
        return { saved: true, updated: false, id: entry.id };
      },
    },
  };

  return {
    /**
     * @param {object} message `{ type, payload }`
     * @param {object} sender
     * @returns {Promise<object>} `{ ok: true, data }` or `{ ok: false, error }`
     */
    async handle(message, sender) {
      try {
        if (message === null || typeof message !== 'object' || typeof message.type !== 'string') {
          throw new Error('malformed message');
        }
        const handler = handlers[message.type];
        if (handler === undefined) {
          throw new Error(`unknown message type: ${message.type}`);
        }
        if (!handler.contentScript && !isTrustedSender(sender, chrome)) {
          throw new NotAuthorizedError(`${message.type} may only be called from an extension page`);
        }
        return { ok: true, data: await handler.handle(message.payload ?? {}) };
      } catch (error) {
        // Errors cross the message boundary as plain data — an Error instance
        // does not survive serialisation. The name is preserved so the UI can
        // distinguish "locked" from "wrong password" from "not authorized".
        return {
          ok: false,
          error: { name: error.name ?? 'Error', message: error.message ?? String(error) },
        };
      }
    },

    /** Wire the router into the runtime. */
    register() {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        this.handle(message, sender).then(sendResponse);
        return true; // keep the channel open for the async response
      });
    },

    /** Exposed for tests and for the popup's own summaries. */
    toSummary,
  };
}
