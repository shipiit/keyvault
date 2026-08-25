import { test, expect, createVault } from './fixtures.js';

const WEAK = 'password1';

/**
 * Watchtower, and the change-password flow it exists to enable.
 *
 * Worth doing end to end because the value here is entirely in the wiring: a
 * score computed in the background, findings rendered in one view, and a
 * button that has to open the right third-party URL.
 */

async function addLogin(page, { title, url, password }) {
  await page
    .getByRole('button', { name: /new item/i })
    .first()
    .click();
  // A new item asks what it is before asking for its details.
  await page.getByRole('radio', { name: /^login/i }).click();
  const titleField = page.getByLabel(/^title/i);
  await expect(titleField).toBeVisible();
  await titleField.fill(title);
  await page
    .getByLabel(/username/i)
    .last()
    .fill('you@example.com');
  await page.getByLabel('Password', { exact: true }).fill(password);
  // The detail pane also labels a URL once an item exists, and it is not an
  // input — so ask for something actually editable rather than the first match.
  const urlField = page.getByLabel(/url|website/i).last();
  if (await urlField.isEditable().catch(() => false)) {
    await urlField.fill(url);
  }
  await page.getByRole('button', { name: /^save/i }).click();
  await expect(titleField).toBeHidden();
}

test('a weak password is reported, and can be fixed from the finding', async ({ vaultPage }) => {
  await createVault(vaultPage);
  await addLogin(vaultPage, { title: 'Weak Site', url: 'https://weak.example', password: WEAK });

  await vaultPage
    .getByRole('button', { name: /watchtower/i })
    .first()
    .click();
  await expect(vaultPage.getByRole('heading', { name: 'Watchtower' })).toBeVisible();
  await expect(vaultPage.getByText('Weak Site').first()).toBeVisible();

  await vaultPage.getByRole('button', { name: 'Change it' }).first().click();

  // The generated replacement must be visible, not merely copied: changing a
  // password takes longer than the clipboard is allowed to hold anything.
  await expect(vaultPage.getByRole('heading', { name: /change this password on/i })).toBeVisible();
  await expect(vaultPage.getByRole('button', { name: /copy new password/i })).toBeVisible();
});

test('the change page opens at the site s own origin', async ({ context, vaultPage }) => {
  await createVault(vaultPage);
  await addLogin(vaultPage, {
    title: 'Weak Site',
    // A deep link, because that is what gets saved in practice — and the
    // well-known path is defined relative to the origin, not the page.
    url: 'https://weak.example/login?next=/home',
    password: WEAK,
  });

  await vaultPage
    .getByRole('button', { name: /watchtower/i })
    .first()
    .click();
  await vaultPage.getByRole('button', { name: 'Change it' }).first().click();

  await context.route('https://weak.example/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Change password</h1>' }),
  );
  const opened = context.waitForEvent('page');
  await vaultPage.getByRole('button', { name: /open change page/i }).click();
  const tab = await opened;

  expect(tab.url()).toBe('https://weak.example/.well-known/change-password');
});

test('reused passwords are grouped together', async ({ vaultPage }) => {
  await createVault(vaultPage);
  const shared = 'the-very-same-password-twice';
  await addLogin(vaultPage, { title: 'First Site', url: 'https://one.example', password: shared });
  await addLogin(vaultPage, { title: 'Second Site', url: 'https://two.example', password: shared });

  await vaultPage
    .getByRole('button', { name: /watchtower/i })
    .first()
    .click();

  await expect(vaultPage.getByRole('heading', { name: /used more than once/i })).toBeVisible();
  await expect(vaultPage.getByText('First Site')).toBeVisible();
  await expect(vaultPage.getByText('Second Site')).toBeVisible();
});

test('a strong unique password produces no findings at all', async ({ vaultPage }) => {
  await createVault(vaultPage);
  await addLogin(vaultPage, {
    title: 'Good Site',
    url: 'https://good.example',
    password: 'C9$mfk2Qz!vLp7Xw#Rt4',
  });

  await vaultPage
    .getByRole('button', { name: /watchtower/i })
    .first()
    .click();

  await expect(vaultPage.getByText(/no problems found/i).first()).toBeVisible();
  await expect(vaultPage.getByRole('button', { name: 'Change it' })).toHaveCount(0);
});
