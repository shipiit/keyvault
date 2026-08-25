/**
 * The sync file, and remembering which one it is.
 *
 * Transport is deliberately the least clever part of sync: the user picks a
 * file inside a folder their machine already synchronises — iCloud Drive,
 * Dropbox, OneDrive, Syncthing — and KeyVault reads and writes it. There is
 * no OAuth, no token, no provider API and no network request. The syncing is
 * done by software the user already trusts with their files, and KeyVault
 * never learns which one it is.
 *
 * The handle is kept in IndexedDB because a `FileSystemFileHandle` is
 * structured-cloneable and `localStorage` is not. Browsers do not always
 * carry the permission across a restart, so `ensurePermission` may need a
 * click — which is why sync is a button in this phase rather than something
 * that happens quietly in the background.
 */

const DB_NAME = 'keyvault-sync';
const STORE = 'handles';
const HANDLE_KEY = 'syncFile';

/** @returns {Promise<IDBDatabase>} */
function openDb() {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * @param {'readonly'|'readwrite'} mode
 * @param {(store: IDBObjectStore) => IDBRequest} run
 */
async function withStore(mode, run) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

/** @returns {Promise<FileSystemFileHandle|null>} */
export async function storedHandle() {
  try {
    return (await withStore('readonly', (store) => store.get(HANDLE_KEY))) ?? null;
  } catch {
    return null;
  }
}

/** @param {FileSystemFileHandle} handle */
export async function rememberHandle(handle) {
  await withStore('readwrite', (store) => store.put(handle, HANDLE_KEY));
}

export async function forgetHandle() {
  await withStore('readwrite', (store) => store.delete(HANDLE_KEY));
}

/** Is this browser capable of the file-based sync at all? */
export function isSupported() {
  return typeof window.showSaveFilePicker === 'function';
}

/**
 * Ask the user to choose the sync file.
 *
 * @returns {Promise<FileSystemFileHandle|null>} null if they cancelled
 */
export async function chooseFile() {
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: 'keyvault.sync.json',
      types: [{ description: 'KeyVault sync file', accept: { 'application/json': ['.json'] } }],
    });
    await rememberHandle(handle);
    return handle;
  } catch (error) {
    // Cancelling a picker is an AbortError, and is not a failure.
    if (error?.name === 'AbortError') {
      return null;
    }
    throw error;
  }
}

/**
 * Confirm we may still read and write the remembered file.
 *
 * @param {FileSystemFileHandle} handle
 * @returns {Promise<boolean>}
 */
export async function ensurePermission(handle) {
  const options = { mode: 'readwrite' };
  if ((await handle.queryPermission(options)) === 'granted') {
    return true;
  }
  return (await handle.requestPermission(options)) === 'granted';
}

/**
 * Read the sync file, or null if it is empty or absent.
 *
 * An unreadable file is reported as an error rather than as "empty":
 * treating a failed read as an empty remote would let the next write
 * overwrite a good file with this device's copy alone.
 *
 * @param {FileSystemFileHandle} handle
 * @returns {Promise<object|null>}
 */
export async function readDocument(handle) {
  const file = await handle.getFile();
  if (file.size === 0) {
    return null;
  }
  const text = await file.text();
  if (text.trim() === '') {
    return null;
  }
  return JSON.parse(text);
}

/**
 * @param {FileSystemFileHandle} handle
 * @param {object} document
 */
export async function writeDocument(handle, document) {
  const writable = await handle.createWritable();
  try {
    await writable.write(JSON.stringify(document));
  } finally {
    // Closing is what commits the write. Skipping it on an error path leaves
    // a zero-length file where the vault used to be.
    await writable.close();
  }
}
