# Installing KeyVault

KeyVault is not on the Chrome Web Store yet, so it installs as an **unpacked
extension**. That is the normal way to run an extension you build yourself, and
it works on every Chromium browser.

Takes about two minutes.

---

## Before you start

You need **Node.js 20 or newer** and **Chromium 116 or newer**.

Check both:

```sh
node --version
```

For the browser, open `chrome://version` — the first line is the version.

> **Why 116?** KeyVault keeps the unlocked vault key in extension session
> storage, and `storage.session.setAccessLevel` is what stops a web page from
> reading it. On older browsers that API is missing, and KeyVault **refuses to
> unlock** rather than running with the key exposed.

---

## Step 1 — Build it

```sh
git clone https://github.com/shipiit/keyvault.git
cd keyvault
npm install
npm run build
```

You should see:

```
Built dist/ — 38 files
```

The `dist/` folder that appears **is** the extension. Note where it is — you
will point the browser at it in a moment. To print the exact path:

```sh
cd dist && pwd
```

---

## Step 2 — Open the extensions page

| Browser     | Type this into the address bar |
| ----------- | ------------------------------ |
| **Chrome**  | `chrome://extensions`          |
| **Edge**    | `edge://extensions`            |
| **Brave**   | `brave://extensions`           |
| **Opera**   | `opera://extensions`           |
| **Vivaldi** | `vivaldi://extensions`         |
| **Arc**     | `arc://extensions`             |

You must type it — these pages cannot be opened by a link.

---

## Step 3 — Turn on Developer mode

Look for the **Developer mode** switch:

- **Chrome, Brave, Opera, Vivaldi, Arc** — top right of the page
- **Edge** — bottom of the left sidebar

Turn it on. Three new buttons appear, including **Load unpacked**.

---

## Step 4 — Load the folder

Click **Load unpacked**, then select the **`dist` folder**.

Select the folder itself — do not open it and pick a file inside, and do not
select the project root. A KeyVault card should appear on the page.

---

## Step 5 — Pin it to the toolbar

Click the puzzle-piece icon in the toolbar, find KeyVault, and click the pin.
The shield icon now sits next to the address bar.

---

## Step 6 — Create your vault

Click the shield icon and choose a master password — at least 12 characters.

> ### Read this before you continue
>
> Your vault is encrypted with this password and stored **only on this device**.
> If you forget it, the vault cannot be recovered. There is no reset link and no
> support account, because there is no server holding a spare key.
>
> This is the trade for having no company able to read your passwords. Choose
> something you will genuinely remember, and export a backup once you have saved
> anything you care about.

---

## Using it

**The toolbar popup** — click the shield. Search, copy a username or password,
read a live two-factor code.

**The full vault** — right-click the shield → **Options**. This opens a full
browser tab with the three-pane manager: categories down the left, your items in
the middle, and the details of the selected item on the right.

**Saving a password** — log in to any site normally. KeyVault offers to save the
username, password and site, the same way Chrome's built-in manager does.

**Filling a password** — open the popup on a site you have saved. Matching items
appear first, under "For this site".

**Auto-login** is off for every item until you turn it on for that specific item,
in the item's edit panel. It is off by default because a look-alike domain could
otherwise capture a login before you notice.

---

## Updating after a code change

```sh
npm run build
```

Then reload the extension:

- Changes to the **popup** or **vault page** — just close and reopen it
- Changes to the **background** or **content script** — click the ↻ reload icon
  on the KeyVault card on the extensions page

---

## Troubleshooting

| What you see                               | What it means                                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| "Manifest file is missing or unreadable"   | You selected the project root, not `dist/`. Go back and pick the `dist` folder.                              |
| "Could not load manifest"                  | `npm run build` has not been run, or it failed. Re-run it and read the output.                               |
| The icon appears but clicking does nothing | The build is stale. Run `npm run build`, then reload the extension.                                          |
| "KeyVault will not unlock on this browser" | The browser is older than Chromium 116. This is deliberate — see the note at the top.                        |
| Autofill does nothing on a site            | The vault is locked, or nothing is saved for that domain. Open the popup to check.                           |
| The save prompt never appears              | The vault is locked, or an item with that exact username already exists for the site with the same password. |
| `npm install` fails                        | Node is older than 20. Check with `node --version`.                                                          |

### Removing it

Open the extensions page and click **Remove** on the KeyVault card.

**This deletes your vault.** The vault lives in the extension's storage, so
removing the extension removes it. Export a backup first if you want to keep it.

---

## A note on trust

You are installing an extension that can read the pages you log in to. That is
what any password manager does, but you should be able to check it rather than
take it on faith:

- `dist/` is a **plain copy** of `src/` — the UI is compiled, but the
  cryptography, the background worker and the content script are unminified. The
  bytes your browser runs are the bytes in this repository, and `diff` will show
  you that.
- The extension requests **no host permissions** at install time and makes **no
  network requests** by default. The only feature that uses the network is
  breach checking, which is off until you enable it.
- `npm test` runs the full suite, including the cryptography, without a browser.

It is also **not yet audited**. Until it is, treat it as something to try rather
than to trust with credentials you cannot afford to lose.
