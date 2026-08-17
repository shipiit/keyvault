import { test, expect, createVault } from './fixtures.js';

const MASTER = 'correct-horse-battery-staple';

/**
 * The vault lifecycle, through the real UI in a real browser.
 *
 * The point of doing this end to end is the service worker. A unit test holds
 * one vault service in one process; Chrome terminates the worker after around
 * thirty seconds idle and rebuilds it from storage, and several shipped bugs
 * existed only on the far side of that restart.
 */

test('a vault can be created, and opens unlocked', async ({ vaultPage }) => {
  await createVault(vaultPage, MASTER);
  await expect(vaultPage.getByRole('button', { name: /new item/i }).first()).toBeVisible();
});

test('an entry survives locking and unlocking', async ({ vaultPage }) => {
  await createVault(vaultPage, MASTER);

  await vaultPage
    .getByRole('button', { name: /new item/i })
    .first()
    .click();
  await vaultPage.getByLabel(/^title/i).fill('GitHub');
  await vaultPage.getByLabel(/username/i).fill('you@example.com');
  await vaultPage
    .getByLabel(/^password/i)
    .first()
    .fill('a-very-long-unique-password');
  await vaultPage.getByRole('button', { name: /^save/i }).click();

  await expect(vaultPage.getByText('GitHub').first()).toBeVisible();

  await vaultPage.getByRole('button', { name: /lock/i }).first().click();
  await expect(vaultPage.getByLabel(/master password/i).first()).toBeVisible();

  await vaultPage
    .getByLabel(/master password/i)
    .first()
    .fill(MASTER);
  await vaultPage
    .getByRole('button', { name: /unlock/i })
    .first()
    .click();

  await expect(vaultPage.getByText('GitHub').first()).toBeVisible();
});

test('the wrong master password does not open the vault', async ({ vaultPage }) => {
  await createVault(vaultPage, MASTER);
  await vaultPage.getByRole('button', { name: /lock/i }).first().click();

  await vaultPage
    .getByLabel(/master password/i)
    .first()
    .fill('not-the-master-password');
  await vaultPage
    .getByRole('button', { name: /unlock/i })
    .first()
    .click();

  await expect(vaultPage.getByRole('alert')).toBeVisible();
  await expect(vaultPage.getByRole('button', { name: /new item/i })).toHaveCount(0);
});

test('the vault survives a service worker restart', async ({ context, vaultPage }) => {
  // The failure this guards: enrolling device unlock threw "vault key must be
  // extractable", but only ever in a worker that had restarted since unlock —
  // which is every real enrolment, and no unit test.
  await createVault(vaultPage, MASTER);

  await vaultPage
    .getByRole('button', { name: /new item/i })
    .first()
    .click();
  await vaultPage.getByLabel(/^title/i).fill('Persisted');
  await vaultPage
    .getByLabel(/^password/i)
    .first()
    .fill('a-very-long-unique-password');
  await vaultPage.getByRole('button', { name: /^save/i }).click();
  await expect(vaultPage.getByText('Persisted').first()).toBeVisible();

  for (const worker of context.serviceWorkers()) {
    await worker.evaluate(() => {
      // Closest available to Chrome's own idle termination.
      self.registration.update();
    });
  }

  await vaultPage.reload();
  await expect(vaultPage.getByText('Persisted').first()).toBeVisible();
});
