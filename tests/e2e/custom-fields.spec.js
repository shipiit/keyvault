import { test, expect, createVault } from './fixtures.js';

const RECOVERY_CODE = 'ZZZZ-1111-YYYY-2222';

/**
 * Custom fields, end to end.
 *
 * The properties worth proving in a browser are the negative ones: a hidden
 * value must not be on screen until asked for, and must not be findable
 * through the search box. A unit test can check the functions; only this can
 * check what was rendered and what the search actually returned.
 */
async function addItemWithField(page, { title, label, value, type }) {
  await page
    .getByRole('button', { name: /new item/i })
    .first()
    .click();
  const titleField = page.getByLabel(/^title/i);
  await expect(titleField).toBeVisible();
  await titleField.fill(title);

  await page.getByRole('button', { name: /add section/i }).click();
  await page.getByLabel('Section name').fill('Recovery');
  await page.getByLabel('Field label').fill(label);
  await page.getByLabel('Field value').fill(value);
  await page.getByLabel('Field type').selectOption(type);

  await page.getByRole('button', { name: /^save/i }).click();
  await expect(titleField).toBeHidden();
}

test('a hidden custom field is stored and shown masked', async ({ vaultPage }) => {
  await createVault(vaultPage);
  await addItemWithField(vaultPage, {
    title: 'Bank',
    label: 'Backup code',
    value: RECOVERY_CODE,
    type: 'concealed',
  });

  await vaultPage.getByText('Bank').first().click();

  // The label is visible — knowing the item has a code is not knowing it.
  await expect(vaultPage.getByText('Backup code').first()).toBeVisible();

  // The value is not.
  expect(await vaultPage.locator('body').innerText()).not.toContain(RECOVERY_CODE);

  // Until asked for, one field at a time.
  await vaultPage.getByRole('button', { name: /show backup code/i }).click();
  await expect(vaultPage.getByText(RECOVERY_CODE)).toBeVisible();
});

test('an ordinary custom field is shown outright', async ({ vaultPage }) => {
  await createVault(vaultPage);
  await addItemWithField(vaultPage, {
    title: 'Bank',
    label: 'Support PIN',
    value: '4417',
    type: 'text',
  });

  await vaultPage.getByText('Bank').first().click();
  await expect(vaultPage.getByText('4417')).toBeVisible();
});

test('search finds the label but never the hidden value', async ({ vaultPage }) => {
  // The search box must not become an oracle: type a guessed secret at an
  // unlocked browser and see whether anything matches.
  await createVault(vaultPage);
  await addItemWithField(vaultPage, {
    title: 'Bank',
    label: 'Backup code',
    value: RECOVERY_CODE,
    type: 'concealed',
  });

  const search = vaultPage
    .getByRole('searchbox')
    .or(vaultPage.getByPlaceholder(/search/i))
    .first();

  // Scoped to the results list. The item stays selected after saving, so its
  // title is in the detail pane no matter what the list is filtered to —
  // asserting on the whole page would pass for the wrong reason.
  const list = vaultPage.getByRole('region', { name: /all items/i });

  await search.fill('backup code');
  await expect(list.getByText('Bank').first()).toBeVisible();

  // Zero is the assertion that matters: the secret must match nothing.
  await search.fill(RECOVERY_CODE);
  await expect(list.getByText('Bank')).toHaveCount(0);
});
