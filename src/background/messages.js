import { createEntry, updateEntry } from '../core/entry.js';
import {
  addEntry,
  replaceEntry,
  removeEntry,
  findEntry,
  searchEntries,
} from '../core/vault-data.js';
import { entriesForUrl, entryMatchesUrl, toHostname } from '../core/url-match.js';
import { generateTotp, totpTimeRemaining } from '../core/totp.js';
import { KeyVaultError } from '../core/errors.js';

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
    title: entry.title,
    username: entry.username,
    urls: entry.urls,
    tags: entry.tags,
    folderId: entry.folderId,
    hasTotp: entry.totp !== null,
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
export function createMessageRouter({ chrome, vault, autoLock, now = () => Date.now() }) {
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
        const entry = createEntry(fields, now());
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
          updated = updateEntry(existing, changes, now());
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
      handle: async ({ url, title, username, password }) => {
        const host = toHostname(url);
        if (host === null) {
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
          if (existing.password === password) {
            return { saved: false, unchanged: true };
          }
          await vault.mutate((current) =>
            replaceEntry(
              current,
              updateEntry(findEntry(current, existing.id), { password }, now()),
            ),
          );
          await autoLock.touch();
          return { saved: true, updated: true, id: existing.id };
        }

        const entry = createEntry(
          {
            title: typeof title === 'string' && title.trim() !== '' ? title.trim() : host,
            username: username ?? '',
            password,
            urls: [`https://${host}`],
          },
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
