import { test, expect, createVault } from './fixtures.js';

/**
 * Tags, end to end.
 *
 * The behaviour worth proving in a browser is the folding: typing a tag that
 * differs only in case must join the existing one rather than creating a
 * near-duplicate. That is the failure that makes tagging worse than not
 * tagging, and it only shows up across a save.
 */
async function addItem(page, { title, tags }) {
  await page
    .getByRole('button', { name: /new item/i })
    .first()
    .click();
  const titleField = page.getByLabel(/^title/i);
  await expect(titleField).toBeVisible();
  await titleField.fill(title);

  const tagBox = page.getByLabel('Add a tag');
  for (const tag of tags) {
    await tagBox.fill(tag);
    await tagBox.press('Enter');
  }

  await page.getByRole('button', { name: /^save/i }).click();
  await expect(titleField).toBeHidden();
}

test('a tagged item gains a sidebar row, and filters to it', async ({ vaultPage }) => {
  await createVault(vaultPage);
  await addItem(vaultPage, { title: 'Bank', tags: ['finance'] });
  await addItem(vaultPage, { title: 'GitHub', tags: ['work'] });

  const finance = vaultPage.getByRole('button', { name: /^finance/i }).first();
  await expect(finance).toBeVisible();
  await finance.click();

  const list = vaultPage.getByRole('region', { name: /finance|all items/i }).first();
  await expect(list.getByText('Bank').first()).toBeVisible();
  await expect(list.getByText('GitHub')).toHaveCount(0);
});

test('tags differing only in case fold into one', async ({ vaultPage }) => {
  // The failure this guards makes tagging worse than not tagging: the
  // sidebar fills with near-duplicates that split the grouping.
  await createVault(vaultPage);
  await addItem(vaultPage, { title: 'One', tags: ['Work'] });
  await addItem(vaultPage, { title: 'Two', tags: ['work'] });

  await expect(vaultPage.getByRole('button', { name: /^work/i })).toHaveCount(1);
});

test('a comma finishes a tag rather than becoming part of it', async ({ vaultPage }) => {
  await createVault(vaultPage);
  await vaultPage
    .getByRole('button', { name: /new item/i })
    .first()
    .click();
  await vaultPage.getByLabel(/^title/i).fill('Item');
  await vaultPage.getByLabel('Add a tag').fill('alpha,beta,');
  await vaultPage.getByRole('button', { name: /^save/i }).click();
  await expect(vaultPage.getByLabel(/^title/i)).toBeHidden();

  await expect(vaultPage.getByRole('button', { name: /^alpha/i }).first()).toBeVisible();
  await expect(vaultPage.getByRole('button', { name: /^beta/i }).first()).toBeVisible();
});

test('there is no Tags heading until something is tagged', async ({ vaultPage }) => {
  // An always-present empty heading teaches people to ignore the sidebar.
  await createVault(vaultPage);
  await expect(vaultPage.getByText('Tags', { exact: true })).toHaveCount(0);

  await addItem(vaultPage, { title: 'Bank', tags: ['finance'] });
  await expect(vaultPage.getByText('Tags', { exact: true }).first()).toBeVisible();
});
