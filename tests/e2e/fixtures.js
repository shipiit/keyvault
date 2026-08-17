import { test as base, chromium, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const distPath = join(root, 'dist');

/**
 * A Chromium with KeyVault actually installed.
 *
 * An extension cannot be loaded into an ordinary Playwright browser: it needs
 * a persistent context with a real on-disk profile, because that is the only
 * shape Chrome will accept `--load-extension` in. The profile is a fresh temp
 * directory per test, so each test starts with no vault — otherwise the first
 * test to create one would decide what every later test sees.
 */
export const test = base.extend({
  context: async ({}, use) => {
    if (!existsSync(join(distPath, 'manifest.json'))) {
      throw new Error('dist/ is missing — run `npm run build` before the e2e tests');
    }

    const profile = await mkdtemp(join(tmpdir(), 'keyvault-e2e-'));
    const context = await chromium.launchPersistentContext(profile, {
      // Extensions require headed Chrome or the new headless mode. The old
      // headless implementation silently loads no extension at all, which
      // presents as every test failing to find the popup.
      headless: true,
      channel: 'chromium',
      args: [`--disable-extensions-except=${distPath}`, `--load-extension=${distPath}`],
    });

    await use(context);

    await context.close();
    await rm(profile, { recursive: true, force: true });
  },

  /** The extension's own ID, which Chrome assigns at load time. */
  extensionId: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    if (worker === undefined) {
      worker = await context.waitForEvent('serviceworker');
    }
    await use(new URL(worker.url()).host);
  },

  /**
   * The vault page, opened and waited for.
   *
   * Extension pages are addressed by `chrome-extension://<id>/…`, so nothing
   * here can run until the extension has loaded — which is itself the first
   * thing worth asserting.
   */
  vaultPage: async ({ context, extensionId }, use) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/ui/vault.html`);
    await use(page);
  },
});

export { expect };

/**
 * Create and unlock a vault.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} master
 */
export async function createVault(page, master = 'correct-horse-battery-staple') {
  await page.getByLabel('Master password', { exact: true }).fill(master);
  await page.getByLabel(/confirm master password/i).fill(master);

  // Onboarding will not let you past without acknowledging that a forgotten
  // master password means the vault is gone. Worth stating in a test: it is
  // the one irreversible property of the whole product, and a future "let's
  // reduce friction" change should have to delete this line deliberately.
  await page.getByRole('checkbox').check();

  await page.getByRole('button', { name: /create vault/i }).click();
  await expect(page.getByRole('button', { name: /new item/i }).first()).toBeVisible();
}

/**
 * A login page served without a network, so the tests do not depend on any
 * site staying online or unchanged.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} body
 */
export async function serveLoginPage(page, body) {
  await page.route('https://e2e.test/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body }),
  );
}

export const LOGIN_HTML = `<!doctype html>
<html><body>
  <h1>Sign in</h1>
  <form id="login" action="/done" method="get">
    <label>Email <input type="email" name="username" id="username"></label>
    <label>Password <input type="password" name="password" id="password"></label>
    <button type="submit">Log in</button>
  </form>
</body></html>`;
