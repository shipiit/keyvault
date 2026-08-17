/**
 * The UI's only channel to the vault.
 *
 * Nothing in `src/ui/` touches storage, crypto, or the vault directly — every
 * read and write goes through the background service worker. That keeps the
 * decryption key out of every window the user can open, and means a bug in a
 * component cannot reach plaintext it was not handed.
 */

import { isDevEnvironment, handleDevMessage, devActiveTabUrl } from './dev-mock.js';

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
