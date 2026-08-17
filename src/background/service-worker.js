/**
 * Extension entry point.
 *
 * This file runs top-to-bottom on **every** service-worker wake, not just at
 * install: Manifest V3 terminates the worker after roughly 30 seconds idle
 * and restarts it on the next event. So it must be cheap, idempotent, and
 * hold no state that matters — everything durable lives in `chrome.storage`.
 *
 * Listeners in particular have to be registered synchronously at the top
 * level. Registering one inside a promise callback is a well-known way to
 * lose events: the worker can be handed an event before the promise settles,
 * find no listener, and drop it.
 */

import { createVaultService } from './vault-service.js';
import { createAutoLock } from './auto-lock.js';
import { createMessageRouter } from './messages.js';
import { resolveBrowserApi, supportsTrustedContexts, describeBrowser } from './browser-api.js';

// Resolved rather than referenced as a global, so the same build runs on
// Chrome, Edge, Brave, Opera, Vivaldi and Arc without branching.
const api = resolveBrowserApi();

const vault = createVaultService({ chrome: api });
const autoLock = createAutoLock({ chrome: api, vault });
const router = createMessageRouter({ chrome: api, vault, autoLock });

// Synchronous, top-level registration — see the note above.
router.register();
autoLock.register();

if (supportsTrustedContexts(api)) {
  // Idempotent, and re-applied on every wake so a worker restart can never
  // leave session storage unrestricted.
  api.storage.session
    .setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
    .catch((error) => console.error('[keyvault] could not restrict session storage', error));
} else {
  // The vault will refuse to unlock. Say so loudly here rather than letting
  // the user meet an opaque failure at the unlock screen.
  const { name, chromiumVersion } = describeBrowser();
  console.error(
    `[keyvault] ${name} ${chromiumVersion ?? '?'} cannot restrict extension session storage ` +
      'to trusted contexts. The vault key would be readable by any web page, so KeyVault ' +
      'will not unlock on this browser. Chromium 116 or newer is required.',
  );
}
