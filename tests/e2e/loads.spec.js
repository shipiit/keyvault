import { test, expect } from './fixtures.js';

/**
 * The extension loads at all.
 *
 * Every failure in this file was a real, shipped bug that the unit suite
 * passed clean through. They are the cheapest tests in the project and would
 * have caught the two worst afternoons of this build.
 */

test('the service worker starts', async ({ context, extensionId }) => {
  expect(extensionId).toMatch(/^[a-z]{32}$/);
  expect(context.serviceWorkers().length).toBeGreaterThan(0);
});

test('the vault page renders, rather than a blank white screen', async ({ vaultPage }) => {
  // The shipped bug: Vite emitted absolute asset paths (`/assets/…`), which
  // resolve under a dev server and 404 under `chrome-extension://`. The page
  // was blank and the only clue was ERR_FILE_NOT_FOUND in the console.
  const failed = [];
  vaultPage.on('requestfailed', (request) => failed.push(request.url()));

  await expect(vaultPage.locator('body')).not.toBeEmpty();
  expect(failed, `assets failed to load: ${failed.join(', ')}`).toEqual([]);
});

test('the popup renders too', async ({ context, extensionId }) => {
  const page = await context.newPage();
  const failed = [];
  page.on('requestfailed', (request) => failed.push(request.url()));

  await page.goto(`chrome-extension://${extensionId}/ui/popup.html`);

  await expect(page.locator('body')).not.toBeEmpty();
  expect(failed).toEqual([]);
});

test('no page throws on load', async ({ context, extensionId }) => {
  // "Cannot use import statement outside a module" was invisible to every
  // unit test: content scripts are classic scripts, and the unit suite
  // imports the source as a module, which is exactly what Chrome will not do.
  const errors = [];
  for (const path of ['ui/vault.html', 'ui/popup.html']) {
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(`${path}: ${error.message}`));
    await page.goto(`chrome-extension://${extensionId}/${path}`);
    await page.waitForTimeout(500);
    await page.close();
  }
  expect(errors).toEqual([]);
});

test('the content script runs in an ordinary page without throwing', async ({ context }) => {
  const errors = [];
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));

  await page.route('https://e2e.test/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html><body><input type="password"></body></html>',
    }),
  );
  await page.goto('https://e2e.test/');
  await page.waitForTimeout(1000);

  expect(errors, `content script threw: ${errors.join(' | ')}`).toEqual([]);
});
