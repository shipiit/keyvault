import { test, expect, createVault } from './fixtures.js';

// Hyphenated on purpose: a realistic sk_live_ + 32 alphanumerics trips
// GitHub's push protection as a genuine Stripe key. The prefix is what the
// detector needs; the rest deliberately cannot be mistaken for real.
const STRIPE_KEY = 'sk_live_EXAMPLE-not-a-real-key';

/**
 * Storing an API credential, end to end.
 *
 * The property worth proving in a browser is negative: that the full secret
 * never reaches the list or the detail pane, only a mask. A unit test can
 * check the function that masks; only this can check what was rendered.
 */
async function addKey(page, { title, secret, environment, expires }) {
  await page
    .getByRole('button', { name: /new item/i })
    .first()
    .click();
  await page.getByRole('radio', { name: /api key/i }).click();

  const titleField = page.getByLabel(/^title/i);
  await expect(titleField).toBeVisible();
  await titleField.fill(title);
  // The masked field is labelled for the type it belongs to — a key is not
  // a password, and calling it one made the form read as a login.
  await page.getByLabel('Key or token', { exact: true }).fill(secret);
  if (environment !== undefined) {
    await page.getByLabel(/environment/i).selectOption(environment);
  }
  if (expires !== undefined) {
    await page.getByLabel(/expires/i).fill(expires);
  }
  await page.getByRole('button', { name: /^save/i }).click();
  await expect(titleField).toBeHidden();
}

test('an API key can be stored and is shown masked, never in full', async ({ vaultPage }) => {
  await createVault(vaultPage);
  await addKey(vaultPage, { title: 'Stripe production', secret: STRIPE_KEY });

  await vaultPage.getByText('Stripe production').first().click();

  // The issuer is identified from the prefix, with no network call.
  await expect(vaultPage.getByText(/Stripe · Secret key/)).toBeVisible();

  // And the secret itself is not on screen.
  const rendered = await vaultPage.locator('body').innerText();
  expect(rendered).not.toContain(STRIPE_KEY);
  expect(rendered).toContain('sk_live');
});

test('a production key filed as development is called out', async ({ vaultPage }) => {
  // The gap that gets a live key handled casually.
  await createVault(vaultPage);
  await addKey(vaultPage, {
    title: 'Mislabelled key',
    secret: STRIPE_KEY,
    environment: 'development',
  });

  await vaultPage.getByText('Mislabelled key').first().click();
  await expect(vaultPage.getByRole('alert')).toContainText(/looks like a production credential/i);
});

test('API keys are not judged as weak passwords', async ({ vaultPage }) => {
  // An API key is whatever length its issuer chose. Scoring it by password
  // rules would fill Watchtower with findings nobody can act on.
  await createVault(vaultPage);
  await addKey(vaultPage, { title: 'Short key', secret: 'abc123' });

  await vaultPage
    .getByRole('button', { name: /watchtower/i })
    .first()
    .click();
  await expect(vaultPage.getByRole('heading', { name: /easy to guess/i })).toHaveCount(0);
});

test('an expiring credential is reported in Watchtower', async ({ vaultPage }) => {
  await createVault(vaultPage);
  const soon = new Date(Date.now() + 7 * 86400000);
  const iso = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`;
  await addKey(vaultPage, { title: 'Expiring soon', secret: STRIPE_KEY, expires: iso });

  await vaultPage
    .getByRole('button', { name: /watchtower/i })
    .first()
    .click();

  await expect(vaultPage.getByRole('heading', { name: /api credentials/i })).toBeVisible();
  await expect(vaultPage.getByText(/expires in \d+d/i)).toBeVisible();
});

test('the sidebar gains an API Keys category once one exists', async ({ vaultPage }) => {
  await createVault(vaultPage);
  await expect(vaultPage.getByRole('button', { name: /api keys/i })).toHaveCount(0);

  await addKey(vaultPage, { title: 'A key', secret: STRIPE_KEY });
  await expect(vaultPage.getByRole('button', { name: /api keys/i }).first()).toBeVisible();
});
