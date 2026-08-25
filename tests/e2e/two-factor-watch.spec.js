import { test, expect, createVault } from './fixtures.js';

/**
 * The missing-two-factor check, end to end.
 *
 * The property worth proving in a browser is the quiet one: a site the
 * bundled list has never heard of must produce no finding at all. A check
 * that nags about sites it cannot know is one people switch off, and then
 * the real findings go unseen too.
 */
async function addLogin(page, { title, url }) {
  await page
    .getByRole('button', { name: /new item/i })
    .first()
    .click();
  const titleField = page.getByLabel(/^title/i);
  await expect(titleField).toBeVisible();
  await titleField.fill(title);
  await page.getByLabel('Password', { exact: true }).fill('a-very-long-unique-password');
  const urlField = page.getByLabel(/url|website/i).last();
  if (await urlField.isEditable().catch(() => false)) {
    await urlField.fill(url);
  }
  await page.getByRole('button', { name: /^save/i }).click();
  await expect(titleField).toBeHidden();
}

test('a known site with no code stored is reported', async ({ vaultPage }) => {
  await createVault(vaultPage);
  await addLogin(vaultPage, { title: 'GitHub', url: 'https://github.com/login' });

  await vaultPage
    .getByRole('button', { name: /watchtower/i })
    .first()
    .click();

  await expect(
    vaultPage.getByRole('heading', { name: /two-factor available but not set up/i }),
  ).toBeVisible();
  await expect(vaultPage.getByText('github.com').first()).toBeVisible();
});

test('a site the list has never heard of is not reported either way', async ({ vaultPage }) => {
  // Silence is the correct answer. A wrong nag trains people to ignore the
  // real findings.
  await createVault(vaultPage);
  await addLogin(vaultPage, { title: 'Local intranet', url: 'https://intranet.example' });

  await vaultPage
    .getByRole('button', { name: /watchtower/i })
    .first()
    .click();

  await expect(
    vaultPage.getByRole('heading', { name: /two-factor available but not set up/i }),
  ).toHaveCount(0);
});

test('the check says what it does not know', async ({ vaultPage }) => {
  // No findings must not read as "no gaps".
  await createVault(vaultPage);
  await addLogin(vaultPage, { title: 'GitHub', url: 'https://github.com/login' });

  await vaultPage
    .getByRole('button', { name: /watchtower/i })
    .first()
    .click();

  await expect(vaultPage.getByText(/built-in list of \d+ sites/i)).toBeVisible();
});
