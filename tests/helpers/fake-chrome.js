/**
 * A minimal in-memory stand-in for the Chrome extension APIs used by
 * `src/background/`.
 *
 * It deliberately reproduces the two behaviours that break real extensions:
 *
 * 1. `chrome.storage.*` round-trips values through JSON, so anything that is
 *    not JSON-serialisable (a `CryptoKey`, for instance) silently degrades to
 *    an empty object rather than throwing.
 * 2. `chrome.storage.session` is cleared when the browser closes, and honours
 *    an access level that decides whether untrusted contexts may read it.
 *
 * Tests that pass against a mock which is more forgiving than the real API are
 * worthless, so this one is not forgiving.
 */

class FakeStorageArea {
  constructor({ sessionLike = false } = {}) {
    this.data = new Map();
    this.sessionLike = sessionLike;
    this.accessLevel = sessionLike ? 'TRUSTED_CONTEXTS' : null;
  }

  async get(keys) {
    const names = keys === null || keys === undefined ? [...this.data.keys()] : [].concat(keys);
    const out = {};
    for (const name of names) {
      if (this.data.has(name)) {
        out[name] = JSON.parse(this.data.get(name));
      }
    }
    return out;
  }

  async set(items) {
    for (const [name, value] of Object.entries(items)) {
      // The real API serialises as JSON. Mirroring that here is the whole
      // point: a CryptoKey stored this way comes back as {}.
      this.data.set(name, JSON.stringify(value));
    }
  }

  async remove(keys) {
    for (const name of [].concat(keys)) {
      this.data.delete(name);
    }
  }

  async clear() {
    this.data.clear();
  }

  async setAccessLevel({ accessLevel }) {
    this.accessLevel = accessLevel;
  }
}

class FakeAlarms {
  constructor() {
    this.alarms = new Map();
    this.listeners = [];
  }

  async create(name, info) {
    this.alarms.set(name, info);
  }

  async clear(name) {
    return this.alarms.delete(name);
  }

  async get(name) {
    return this.alarms.get(name) ?? null;
  }

  get onAlarm() {
    return { addListener: (fn) => this.listeners.push(fn) };
  }

  /** Test hook: pretend the alarm fired. */
  async fire(name) {
    for (const fn of this.listeners) {
      await fn({ name });
    }
  }
}

class FakeEvent {
  constructor() {
    this.listeners = [];
  }

  addListener(fn) {
    this.listeners.push(fn);
  }

  async emit(...args) {
    const results = [];
    for (const fn of this.listeners) {
      results.push(await fn(...args));
    }
    return results;
  }
}

export function createFakeChrome() {
  const chrome = {
    storage: {
      local: new FakeStorageArea(),
      session: new FakeStorageArea({ sessionLike: true }),
    },
    alarms: new FakeAlarms(),
    runtime: {
      onMessage: new FakeEvent(),
      onStartup: new FakeEvent(),
      onInstalled: new FakeEvent(),
      lastError: null,
      id: 'fake-extension-id',
    },
  };

  /** Test hook: simulate the browser closing and reopening. */
  chrome.__restartBrowser = async () => {
    await chrome.storage.session.clear();
  };

  /**
   * Test hook: simulate the MV3 service worker being torn down after idle.
   * Session storage survives; anything in a module variable does not.
   */
  chrome.__terminateServiceWorker = () => {};

  return chrome;
}
