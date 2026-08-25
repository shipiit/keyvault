import { test, expect, createVault } from './fixtures.js';

/**
 * SSH keys, end to end.
 *
 * The fingerprint is pinned against real `ssh-keygen -lf` output. One that is
 * close but not identical is worse than none: it looks right and never
 * matches the string somebody is comparing it against.
 */
const PUBLIC_KEY =
  'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIG7X4WiFidUT+i28adRtLRCpqHHfJAQeI+ks2/oy4Z0z e2e@example.com';
const FINGERPRINT = 'SHA256:CvUfkfM1vTPGo06QxVD78xTrPhd8H44RfOabXolLZU8';

async function addKey(page, title) {
  await page
    .getByRole('button', { name: /new item/i })
    .first()
    .click();
  await page.getByRole('radio', { name: /ssh key/i }).click();
  const titleField = page.getByLabel(/^title/i);
  await expect(titleField).toBeVisible();
  await titleField.fill(title);
  await page.getByLabel(/public key/i).fill(PUBLIC_KEY);
  await page.getByRole('button', { name: /^save/i }).click();
  await expect(titleField).toBeHidden();
}

test('an SSH key shows the fingerprint ssh-keygen would print', async ({ vaultPage }) => {
  await createVault(vaultPage);
  await addKey(vaultPage, 'Laptop key');

  await vaultPage.getByText('Laptop key').first().click();

  await expect(vaultPage.getByText(FINGERPRINT)).toBeVisible();
  await expect(vaultPage.getByText('Ed25519').first()).toBeVisible();
  await expect(vaultPage.getByText('e2e@example.com').first()).toBeVisible();
});

test('the SSH Keys category appears once one is saved', async ({ vaultPage }) => {
  await createVault(vaultPage);
  await expect(vaultPage.getByRole('button', { name: /ssh keys/i })).toHaveCount(0);

  await addKey(vaultPage, 'Laptop key');
  await expect(vaultPage.getByRole('button', { name: /ssh keys/i }).first()).toBeVisible();
});
