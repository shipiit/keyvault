import { test, expect, createVault, serveLoginPage, LOGIN_HTML } from './fixtures.js';

const PASSWORD = 'a-very-long-unique-password';

/**
 * The archive, end to end.
 *
 * The property that makes archiving worth having is the one a unit test
 * cannot see: an archived login must stop being offered to the login form of
 * the site it belongs to. That is the whole reason somebody archives a closed
 * account rather than leaving it in the list.
 */
async function addLogin(page, { title, url }) {
  await page
    .getByRole('button', { name: /new item/i })
    .first()
    .click();
  const titleField = page.getByLabel(/^title/i);
  await expect(titleField).toBeVisible();
  await titleField.fill(title);
  await page
    .getByLabel(/username/i)
    .last()
    .fill('you@example.com');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  const urlField = page.getByLabel(/url|website/i).last();
  if (await urlField.isEditable().catch(() => false)) {
    await urlField.fill(url);
  }
  await page.getByRole('button', { name: /^save/i }).click();
  await expect(titleField).toBeHidden();
}

async function archiveSelected(page) {
  await page
    .getByRole('button', { name: /more actions|more options|⋯|actions/i })
    .first()
    .click();
  await page.getByRole('menuitem', { name: /^archive$/i }).click();
}

test('an archived login is no longer autofilled', async ({ context, vaultPage }) => {
  await createVault(vaultPage);
  await addLogin(vaultPage, { title: 'Old account', url: 'https://e2e.test/login' });

  // It fills before archiving.
  const before = await context.newPage();
  await serveLoginPage(before, LOGIN_HTML);
  await before.goto('https://e2e.test/login');
  await expect(before.locator('#password')).toHaveValue(PASSWORD, { timeout: 15_000 });
  await before.close();

  await vaultPage.getByText('Old account').first().click();
  await archiveSelected(vaultPage);

  // And does not after.
  const after = await context.newPage();
  await serveLoginPage(after, LOGIN_HTML);
  await after.goto('https://e2e.test/login');
  await after.waitForTimeout(3000);
  await expect(after.locator('#password')).toHaveValue('');
});

test('archiving removes it from the list but keeps it in the archive', async ({ vaultPage }) => {
  await createVault(vaultPage);
  await addLogin(vaultPage, { title: 'Old account', url: 'https://e2e.test/login' });

  await vaultPage.getByText('Old account').first().click();
  await archiveSelected(vaultPage);

  const list = vaultPage.getByRole('region', { name: /all items/i });
  await expect(list.getByText('Old account')).toHaveCount(0);

  await vaultPage
    .getByRole('button', { name: /^archive/i })
    .first()
    .click();
  await expect(vaultPage.getByText('Old account').first()).toBeVisible();
});

test('an archived item can be restored', async ({ vaultPage }) => {
  await createVault(vaultPage);
  await addLogin(vaultPage, { title: 'Old account', url: 'https://e2e.test/login' });

  await vaultPage.getByText('Old account').first().click();
  await archiveSelected(vaultPage);

  await vaultPage
    .getByRole('button', { name: /^archive/i })
    .first()
    .click();
  await vaultPage
    .getByRole('button', { name: /restore/i })
    .first()
    .click();

  await vaultPage
    .getByRole('button', { name: /all items/i })
    .first()
    .click();
  await expect(vaultPage.getByText('Old account').first()).toBeVisible();
});
