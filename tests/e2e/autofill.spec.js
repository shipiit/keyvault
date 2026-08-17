import { test, expect, createVault, serveLoginPage, LOGIN_HTML } from './fixtures.js';

const USERNAME = 'you@example.com';
const PASSWORD = 'a-very-long-unique-password';

/**
 * Autofill, against a real page in a real browser.
 *
 * This is the half of the extension that unit tests reach least well. The
 * content script is a classic script in a hostile document, talking to a
 * service worker across a message boundary; nearly every autofill bug found
 * in daily use lived in that arrangement rather than in any one module.
 */

async function saveLogin(page, { url = 'https://e2e.test/login' } = {}) {
  await page
    .getByRole('button', { name: /new item/i })
    .first()
    .click();

  // Wait for the drawer rather than assuming it opened. Filling a field that
  // has not rendered yet silently does nothing and the failure surfaces much
  // later, as a missing item, which is what made this helper flaky.
  const title = page.getByLabel(/^title/i);
  await expect(title).toBeVisible();

  await title.fill('E2E Test Site');
  await page.getByLabel(/username/i).fill(USERNAME);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  const urlField = page.getByLabel(/url|website/i).first();
  if (await urlField.isVisible().catch(() => false)) {
    await urlField.fill(url);
  }

  await page.getByRole('button', { name: /^save/i }).click();
  await expect(title).toBeHidden();
  await expect(page.getByText('E2E Test Site').first()).toBeVisible();
}

test('a saved login is filled into the page as it loads', async ({ context, vaultPage }) => {
  await createVault(vaultPage);
  await saveLogin(vaultPage);

  const page = await context.newPage();
  await serveLoginPage(page, LOGIN_HTML);
  await page.goto('https://e2e.test/login');

  await expect(page.locator('#username')).toHaveValue(USERNAME, { timeout: 15_000 });
  await expect(page.locator('#password')).toHaveValue(PASSWORD);
});

test('nothing is filled on a site the credential does not belong to', async ({
  context,
  vaultPage,
}) => {
  // The failure mode that matters most: a look-alike domain harvesting a
  // credential that autofill volunteered.
  await createVault(vaultPage);
  await saveLogin(vaultPage);

  const page = await context.newPage();
  await page.route('https://e2e.test.evil.co/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: LOGIN_HTML }),
  );
  await page.goto('https://e2e.test.evil.co/login');
  await page.waitForTimeout(3000);

  await expect(page.locator('#username')).toHaveValue('');
  await expect(page.locator('#password')).toHaveValue('');
});

test('the page cannot read a password out of the extension', async ({ context, vaultPage }) => {
  // Everything the extension puts in the page lives in a closed shadow root,
  // and the menu is given metadata only. A page script should find no trace
  // of the password anywhere in its own DOM.
  await createVault(vaultPage);
  await saveLogin(vaultPage);

  const page = await context.newPage();
  await serveLoginPage(page, LOGIN_HTML);
  await page.goto('https://e2e.test/login');
  await expect(page.locator('#password')).toHaveValue(PASSWORD, { timeout: 15_000 });

  const reachable = await page.evaluate((secret) => {
    const found = [];
    // The filled field itself legitimately holds it; everything else must not.
    if (document.documentElement.outerHTML.includes(secret)) found.push('serialised DOM');
    for (const host of document.querySelectorAll('*')) {
      if (host.shadowRoot && host.shadowRoot.innerHTML.includes(secret)) found.push('open shadow');
    }
    return found;
  }, PASSWORD);

  expect(reachable).toEqual([]);
});

test('a login typed by hand is offered for saving', async ({ context, vaultPage }) => {
  await createVault(vaultPage);

  const page = await context.newPage();
  await serveLoginPage(page, LOGIN_HTML);
  await page.route('https://e2e.test/done*', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Signed in</h1>' }),
  );
  await page.goto('https://e2e.test/login');

  await page.locator('#username').fill('someone@example.com');
  await page.locator('#password').fill('a-different-long-password');
  await page.locator('button[type=submit]').click();

  // The prompt is rendered inside a closed shadow root on documentElement, so
  // it is deliberately unreachable from page script and from Playwright's
  // ordinary selectors. Its host element is the observable part.
  await expect(page.locator('#keyvault-save-prompt, #keyvault-inline-menu')).toHaveCount(1, {
    timeout: 15_000,
  });
});
