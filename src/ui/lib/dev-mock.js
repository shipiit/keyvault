/**
 * An in-memory stand-in for the background service worker, used **only** when
 * the UI is opened in a plain browser tab via `npm run dev`.
 *
 * This exists so the interface can be designed and reviewed without packaging
 * and reloading the extension on every change. It is not a second
 * implementation of the vault: it stores fake data in a module variable, does
 * no cryptography, and persists nothing.
 *
 * It can never activate inside the real extension. `isDevEnvironment()`
 * requires `chrome.runtime` to be *absent*, and inside an extension page that
 * object always exists. The mock's own data is obviously fake, so a misfire
 * would be immediately visible rather than silently wrong.
 */

const DEMO_ENTRIES = [
  {
    id: 'demo-1',
    title: 'GitHub',
    username: 'you@example.com',
    urls: ['https://github.com'],
    tags: ['dev'],
    folderId: null,
    hasTotp: true,
    autoSubmit: false,
    lastUsedAt: 1700000900000,
    updatedAt: 1700000000000,
  },
  {
    id: 'demo-2',
    title: 'Figma',
    username: 'you@example.com',
    urls: ['https://figma.com'],
    tags: ['design'],
    folderId: null,
    hasTotp: false,
    autoSubmit: false,
    lastUsedAt: 1700000800000,
    updatedAt: 1700000000000,
  },
  {
    id: 'demo-3',
    title: 'Bank of Example',
    username: 'r.raj',
    urls: ['https://bank.example'],
    tags: ['finance'],
    folderId: null,
    hasTotp: true,
    autoSubmit: false,
    lastUsedAt: null,
    updatedAt: 1700000000000,
  },
  {
    id: 'demo-4',
    title: 'Cloudflare',
    username: 'ops@iamrraj.com',
    urls: ['https://dash.cloudflare.com'],
    tags: ['infra'],
    folderId: null,
    hasTotp: false,
    autoSubmit: true,
    lastUsedAt: 1700000700000,
    updatedAt: 1700000000000,
  },
];

/** Read from the URL so every screen can be reviewed: ?state=new|locked|open */
function initialState() {
  const requested = new URLSearchParams(window.location.search).get('state');
  if (requested === 'new') return { initialized: false, locked: true };
  if (requested === 'locked') return { initialized: true, locked: true };
  return { initialized: true, locked: false };
}

const state = { ...initialState(), entries: [...DEMO_ENTRIES] };

/** @returns {boolean} true only outside an extension context */
export function isDevEnvironment() {
  const api = globalThis.chrome ?? globalThis.browser;
  return api?.runtime?.sendMessage === undefined;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const handlers = {
  'vault/status': async () => ({ initialized: state.initialized, locked: state.locked }),

  'vault/create': async ({ password }) => {
    // Mirrors the real minimum so the onboarding validation can be reviewed.
    if (password.length < 12) {
      throw Object.assign(new Error('master password must be at least 12 characters'), {
        name: 'RangeError',
      });
    }
    // Deriving at 600k iterations takes real time; simulate it so the
    // loading state is visible during review rather than a flash.
    await delay(400);
    state.initialized = true;
    state.locked = false;
    return { created: true };
  },

  'vault/unlock': async ({ password }) => {
    await delay(400);
    if (password !== 'demo') {
      throw Object.assign(new Error('incorrect master password'), {
        name: 'InvalidPasswordError',
      });
    }
    state.locked = false;
    return { unlocked: true };
  },

  'vault/lock': async () => {
    state.locked = true;
    return { locked: true };
  },

  'entries/list': async ({ query = '' }) => {
    if (state.locked) {
      throw Object.assign(new Error('vault is locked'), { name: 'VaultLockedError' });
    }
    const needle = query.trim().toLowerCase();
    return {
      entries: state.entries.filter((entry) =>
        needle === ''
          ? true
          : [entry.title, entry.username, ...entry.urls, ...entry.tags]
              .join('\n')
              .toLowerCase()
              .includes(needle),
      ),
    };
  },

  'entries/get': async ({ id }) => {
    const summary = state.entries.find((entry) => entry.id === id);
    return { entry: { ...summary, password: 'demo-password-not-real', notes: '' } };
  },

  'entries/totp': async () => {
    const remaining = 30 - (Math.floor(Date.now() / 1000) % 30);
    // Derived from the clock so the countdown ring animates realistically.
    const code = String((Math.floor(Date.now() / 30000) * 7919) % 1000000).padStart(6, '0');
    return { code, remainingSeconds: remaining };
  },
};

/**
 * @param {string} type
 * @param {object} payload
 * @returns {Promise<object>}
 */
export async function handleDevMessage(type, payload) {
  const handler = handlers[type];
  if (handler === undefined) {
    throw new Error(`dev mock has no handler for ${type}`);
  }
  return handler(payload ?? {});
}

/** The active tab URL the mock reports, so "For this site" can be reviewed. */
export function devActiveTabUrl() {
  return 'https://github.com/login';
}
