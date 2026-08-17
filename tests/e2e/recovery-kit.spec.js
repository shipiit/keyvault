import { test, expect, createVault } from './fixtures.js';

const MASTER = 'correct-horse-battery-staple';
const SECRET = 'a-very-long-unique-password';

/**
 * The recovery kit, rendered in a real browser.
 *
 * The property worth testing end to end is negative: that nothing secret
 * reaches the page. A unit test can check the object handed to the component;
 * only this can check what the component actually put on screen, which is
 * what would reach a printer.
 */

test('the sheet identifies the vault without revealing anything', async ({ vaultPage }) => {
  await createVault(vaultPage, MASTER);

  await vaultPage
    .getByRole('button', { name: /new item/i })
    .first()
    .click();
  await vaultPage.getByLabel(/^title/i).fill('Bank');
  await vaultPage
    .getByLabel(/username/i)
    .last()
    .fill('you@example.com');
  await vaultPage.getByLabel('Password', { exact: true }).fill(SECRET);
  await vaultPage.getByRole('button', { name: /^save/i }).click();
  await expect(vaultPage.getByText('Bank').first()).toBeVisible();

  await vaultPage
    .getByRole('button', { name: /recovery kit/i })
    .first()
    .click();

  const sheet = vaultPage.locator('#recovery-sheet');
  await expect(sheet).toBeVisible();

  // A vault ID, so a backup file can be matched to the vault it came from.
  await expect(sheet).toContainText(/[0-9A-F]{4}-[0-9A-F]{4}/);
  await expect(sheet).toContainText('1');

  // And nothing that would be worth stealing off a printed page.
  const printed = await sheet.innerText();
  expect(printed).not.toContain(SECRET);
  expect(printed).not.toContain(MASTER);
  expect(printed).not.toContain('you@example.com');
  expect(printed).not.toContain('Bank');
});

test('it says the master password cannot be printed, and leaves room to write it', async ({
  vaultPage,
}) => {
  // The blank box is the feature. Printing the password would send it through
  // a spooler and possibly a shared printer on its way to a drawer.
  await createVault(vaultPage, MASTER);
  await vaultPage
    .getByRole('button', { name: /recovery kit/i })
    .first()
    .click();

  const sheet = vaultPage.locator('#recovery-sheet');
  await expect(sheet).toContainText(/write it here by hand/i);
  await expect(sheet).toContainText(/never stored anywhere/i);
});

test('it states the consequence of losing the password plainly', async ({ vaultPage }) => {
  await createVault(vaultPage, MASTER);
  await vaultPage
    .getByRole('button', { name: /recovery kit/i })
    .first()
    .click();

  await expect(vaultPage.locator('#recovery-sheet')).toContainText(/the items are gone/i);
});
