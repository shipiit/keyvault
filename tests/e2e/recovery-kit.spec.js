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
  // A new item asks what it is before asking for its details.
  await vaultPage.getByRole('radio', { name: /^login/i }).click();
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

test('it offers a field for the password rather than assuming it is written by hand', async ({
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
  await expect(sheet).toContainText(/never stored anywhere/i);
  await expect(sheet.getByLabel(/master password to print/i)).toBeVisible();
});

test('printing opens a separate tab, since the popup cannot print', async ({
  context,
  vaultPage,
}) => {
  // The reported bug: pressing Print did nothing. window.print() was being
  // called correctly — but from a context Chrome ignores, onto a dark-themed
  // sheet that would have printed white on white anyway.
  await createVault(vaultPage, MASTER);
  await vaultPage
    .getByRole('button', { name: /recovery kit/i })
    .first()
    .click();
  await expect(vaultPage.locator('#recovery-sheet')).toBeVisible();

  const opened = context.waitForEvent('page');
  await vaultPage.getByRole('button', { name: /^print$/i }).click();
  const sheetTab = await opened;

  const printed = await sheetTab.content();
  expect(printed).toContain('KeyVault Recovery Kit');
  expect(printed).toMatch(/[0-9A-F]{4}-[0-9A-F]{4}/);
  // Black on white, regardless of the theme the app was in.
  expect(printed).toContain('color: #000');
});

test('a typed password reaches the printed sheet, and warns on it', async ({
  context,
  vaultPage,
}) => {
  await createVault(vaultPage, MASTER);
  await vaultPage
    .getByRole('button', { name: /recovery kit/i })
    .first()
    .click();

  await vaultPage.getByLabel(/master password to print/i).fill(MASTER);
  await vaultPage.getByLabel(/where the backup file is/i).fill('Documents/backup.json');

  const opened = context.waitForEvent('page');
  await vaultPage.getByRole('button', { name: /^print$/i }).click();
  const printed = await (await opened).content();

  expect(printed).toContain(MASTER);
  expect(printed).toContain('Documents/backup.json');
  // Whoever finds the sheet later must be told what they are holding.
  expect(printed).toMatch(/contains your master password/i);
});

test('leaving the password blank keeps it off the sheet entirely', async ({
  context,
  vaultPage,
}) => {
  await createVault(vaultPage, MASTER);
  await vaultPage
    .getByRole('button', { name: /recovery kit/i })
    .first()
    .click();

  const opened = context.waitForEvent('page');
  await vaultPage.getByRole('button', { name: /^print$/i }).click();
  const printed = await (await opened).content();

  expect(printed).not.toContain(MASTER);
  expect(printed).not.toMatch(/contains your master password/i);
  expect(printed).toContain('class="rule"');
});

test('it states the consequence of losing the password plainly', async ({ vaultPage }) => {
  await createVault(vaultPage, MASTER);
  await vaultPage
    .getByRole('button', { name: /recovery kit/i })
    .first()
    .click();

  await expect(vaultPage.locator('#recovery-sheet')).toContainText(/the items are gone/i);
});
