/**
 * The UI's only channel to the vault.
 *
 * Nothing in `src/ui/` touches storage, crypto, or the vault directly — every
 * read and write goes through the background service worker. That keeps the
 * decryption key out of every window the user can open, and means a bug in a
 * component cannot reach plaintext it was not handed.
 */

import { isDevEnvironment, handleDevMessage, devActiveTabUrl } from './dev-mock.js';

import { findTotpInImages } from './qr-decode.js';

const api = globalThis.chrome ?? globalThis.browser;

/**
 * True only when the UI is running in a plain browser tab (`npm run dev`),
 * never inside the packaged extension — see `dev-mock.js`.
 */
const useDevMock = isDevEnvironment();

/**
 * An error carried across the message boundary.
 *
 * Error instances do not survive structured messaging, so the background
 * layer sends `{ name, message }` and this reconstitutes something throwable
 * with the name intact — the UI branches on `name` to tell "locked" from
 * "wrong password" from "not authorised".
 */
export class BackgroundError extends Error {
  constructor({ name, message }) {
    super(message);
    this.name = name;
  }
}

/**
 * @param {string} type
 * @param {object} [payload]
 * @returns {Promise<object>} the handler's data
 * @throws {BackgroundError}
 */
export async function send(type, payload = {}) {
  if (useDevMock) {
    try {
      return await handleDevMessage(type, payload);
    } catch (error) {
      throw new BackgroundError({ name: error.name, message: error.message });
    }
  }

  const response = await api.runtime.sendMessage({ type, payload });
  if (response === undefined) {
    throw new BackgroundError({
      name: 'NoResponseError',
      message: 'the extension background is not responding; try reloading the extension',
    });
  }
  if (!response.ok) {
    throw new BackgroundError(response.error);
  }
  return response.data;
}

/** @returns {Promise<{initialized: boolean, locked: boolean}>} */
export const getStatus = () => send('vault/status');

export const createVault = (password) => send('vault/create', { password });
export const unlockVault = (password) => send('vault/unlock', { password });
export const lockVault = () => send('vault/lock');

export const listEntries = (query = '') => send('entries/list', { query });
export const getEntry = (id) => send('entries/get', { id });
export const createEntryRemote = (fields) => send('entries/create', { fields });
export const updateEntryRemote = (id, changes) => send('entries/update', { id, changes });
export const deleteEntryRemote = (id) => send('entries/delete', { id });
export const restoreEntryRemote = (id) => send('entries/restore', { id });
export const purgeEntryRemote = (id) => send('entries/purge', { id });
export const listTrash = () => send('entries/trash');
export const emptyTrash = () => send('entries/emptyTrash');
export const getTotp = (id) => send('entries/totp', { id });

/**
 * The URL of the tab the popup was opened over, used to surface matching
 * credentials first. Returns null on extension and browser-internal pages,
 * where there is nothing to match against.
 *
 * @returns {Promise<string|null>}
 */
export async function getActiveTabUrl() {
  // Opening the popup from the toolbar is the user gesture that grants
  // activeTab for the current tab, which is what makes `url` readable here.
  // The broad "tabs" permission would also work but carries an install-time
  // warning about reading browsing history, for no additional capability.
  //
  // If the URL is unavailable for any reason, the caller simply loses the
  // "For this site" grouping — the vault list still works in full.
  if (useDevMock) {
    return devActiveTabUrl();
  }
  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url ?? '';
    return url.startsWith('http://') || url.startsWith('https://') ? url : null;
  } catch {
    return null;
  }
}

/**
 * Ask the page in the active tab to fill this credential.
 *
 * The background still re-checks that the entry belongs to that origin
 * before releasing anything, so this is a convenience, not a bypass.
 *
 * @param {string} id
 * @returns {Promise<{filled: boolean, reason?: string}>}
 */
export async function fillOnActiveTab(id) {
  if (useDevMock) {
    return { filled: true };
  }
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) {
    return { filled: false, reason: 'no active tab' };
  }
  try {
    return (
      (await api.tabs.sendMessage(tab.id, { type: 'content/fill', payload: { id } })) ?? {
        filled: false,
      }
    );
  } catch {
    return { filled: false, reason: 'KeyVault cannot reach that page — reload it and try again.' };
  }
}

/**
 * Look for a TOTP setup code in the user's open tabs.
 *
 * Which tab to ask is not obvious, and getting it wrong is why this first
 * failed: from the popup the active tab *is* the page with the QR code, but
 * from the full vault page the active tab is the vault itself. So the active
 * tab is tried first, and then the others in the same window.
 *
 * Only runs on an explicit click, only reads pages that already have the
 * content script, and only looks for an `otpauth://` pattern.
 *
 * Without the broad `tabs` permission — which KeyVault deliberately does not
 * request, because it warns about reading browsing history — `tab.url` and
 * `tab.title` come back undefined. Messaging still works, so the scan is
 * unaffected; the extension simply cannot name the tab it read, and says so
 * rather than guessing.
 *
 * @returns {Promise<{found: boolean, uri?: string, secret?: string,
 *                    source?: string, tabTitle?: string, reason?: string}>}
 */
export async function scanOpenTabsForTotp() {
  if (useDevMock) {
    return {
      found: true,
      uri: 'otpauth://totp/Demo:you@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Demo',
      source: 'text',
      tabTitle: 'Demo two-factor setup',
    };
  }

  const ownPrefix = `chrome-extension://${api.runtime.id}/`;
  // Every window, not just this one. The vault page opens as its own tab and
  // is often in a different window from the setup page being scanned, which
  // made the scan report that it could not read any tab at all.
  const tabs = await api.tabs.query({});

  // Active tab first: from the popup it is the page the user is looking at,
  // and it is the answer they expect.
  const ordered = [...tabs].sort((a, b) => Number(b.active) - Number(a.active));

  let reachable = 0;
  // Images are collected across every tab and decoded only after the cheap
  // strategies have all failed, so a page that simply prints the URI never
  // pays for a decode.
  const captured = [];

  for (const tab of ordered) {
    if (tab.id === undefined || (tab.url ?? '').startsWith(ownPrefix)) {
      continue;
    }
    try {
      const result = await api.tabs.sendMessage(tab.id, { type: 'content/scanTotp' });
      reachable += 1;
      if (result?.found) {
        return { ...result, tabTitle: tab.title ?? '' };
      }
      for (const dataUrl of result?.images ?? []) {
        captured.push({ dataUrl, tabTitle: tab.title ?? '' });
      }
    } catch {
      // No content script in this tab: a browser-internal page, or a tab
      // opened before the extension was installed or last reloaded.
      continue;
    }
  }

  if (captured.length > 0) {
    const decoded = await findTotpInImages(captured.map((item) => item.dataUrl));
    if (decoded !== null) {
      return { found: true, ...decoded, tabTitle: captured[0].tabTitle };
    }
  }

  return {
    found: false,
    reason:
      reachable === 0
        ? 'KeyVault could not read any open tab. Open the page showing the QR code, reload ' +
          'that page, then try again.'
        : captured.length > 0
          ? `Found ${captured.length} QR ${captured.length === 1 ? 'image' : 'images'} but ` +
            'none held a two-factor setup code. If the code is inside an image from another ' +
            'site, KeyVault cannot read its pixels — use the setup key instead.'
          : `No two-factor setup code found in your ${reachable} open ` +
            `${reachable === 1 ? 'tab' : 'tabs'}. Open the page showing the QR code and try again.`,
  };
}

/**
 * Copy text, then clear the clipboard after a delay.
 *
 * Clipboard contents are readable by anything the user pastes into next, and
 * by some background software. Clearing bounds that exposure. It is a
 * mitigation, not a guarantee — a paste before the timer wins.
 *
 * @param {string} text
 * @param {number} [clearAfterMs]
 */
export async function copyWithAutoClear(text, clearAfterMs = 30000) {
  await navigator.clipboard.writeText(text);
  setTimeout(() => {
    navigator.clipboard.writeText('').catch(() => {
      // The popup usually closes before this fires, which revokes clipboard
      // permission. Nothing to recover from, and nothing worth logging.
    });
  }, clearAfterMs);
}

/** Whether a newer release exists, from the day-old cached answer. */
export function updateStatus() {
  return send('updates/status');
}

/** Ask again now, ignoring the cache. */
export function checkForUpdate() {
  return send('updates/check');
}

/** Data for the printable recovery kit. Contains no secrets by construction. */
export function recoveryKit() {
  return send('vault/recoveryKit');
}

/** File an entry away without deleting it. */
export function archiveEntryRemote(id) {
  return send('entries/archive', { id });
}

/** Put an archived entry back into circulation. */
export function unarchiveEntryRemote(id) {
  return send('entries/unarchive', { id });
}

/** Everything currently archived. */
export function listArchive() {
  return send('entries/archived');
}
