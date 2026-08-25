# Roadmap

What is left to build, in the order it should be built, and the decisions that
are still open.

Stages 1 and 2 are complete; stage 3 is in progress. The extension loads and
runs in a Chromium browser today.

---

## Resolved: how the unlocked key survives a worker restart

A Manifest V3 service worker is terminated after roughly 30 seconds idle, taking
any in-memory key with it. `chrome.storage.session` survives that — but it
serialises values as **JSON**, and a `CryptoKey` is not JSON-serialisable, so
storing one there yields an empty object with no error raised.

Rather than gamble on the platform, the key is parked as **raw bytes** and
re-imported on each wake. That is correct whichever way `chrome.storage`
behaves, so no probe was needed to unblock the work. A test pins the
serialisation behaviour, so if the platform ever changes, the design can be
simplified deliberately rather than by accident.

The trade-off is stated plainly: raw key bytes sit briefly as JSON in a
memory-only store rather than as an opaque handle.
`storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })` is what
keeps content scripts out, and where that API is unavailable KeyVault refuses to
unlock rather than running with the key exposed.

---

## Stage 2 — Runtime ✅ complete

Turns the core library into a working locked/unlocked vault.

- `manifest.json` — MV3, minimum permissions, `script-src 'self'`
- Service worker: key custody, lock state, message router
- `chrome.storage.local` persistence with **rotating backup** — the previous
  vault blob is retained on every write, so a single corrupt write is always
  recoverable
- Auto-lock via `chrome.alarms` (survives worker termination; `setTimeout` does
  not), plus lock-on-browser-close and manual lock
- A deliberately narrow message API. Content scripts may ask only "which entries
  match this origin" (metadata, never secrets) and "fill entry X here". They can
  never enumerate the vault or read the key.
- Integration tests over the lock/unlock lifecycle and storage persistence

**Done when:** a vault can be created, locked, unlocked and persisted across a
forced service-worker restart.

---

## Unlock with Touch ID / Windows Hello

Requested, and it is possible — but it changes where the vault key can come
from, so it needs designing rather than bolting on.

**The problem.** The vault key is derived from the master password. Biometrics
do not produce a key; a fingerprint check is a yes/no answer. Treating that
answer as authorisation to unlock would mean the key had to be sitting
somewhere already readable, which removes the guarantee the whole design rests
on: that a stolen vault file is worthless without the master password.

**The mechanism that actually works** is the WebAuthn `prf` extension. A
platform authenticator (the Secure Enclave on a Mac, the TPM on Windows) can
derive a stable secret from a credential plus a salt, released only after a
successful biometric or device-password check. That secret is real key
material, not a boolean.

The flow:

1. The user unlocks once with the master password, as today.
2. They opt in to device unlock. KeyVault registers a WebAuthn credential with
   `prf` enabled, derives a wrapping key from the PRF output, and stores the
   vault key encrypted under it.
3. On later unlocks, the authenticator releases the PRF output after Touch ID
   or the device password, which unwraps the vault key.

**What this does and does not change:**

- The master password still exists and still works. Device unlock is a second
  door, never a replacement — losing the device must not lose the vault.
- The wrapped key is bound to this device's authenticator. It cannot be moved,
  and it is useless in a copied vault file.
- Anyone who can pass the device's own biometric or password check can open the
  vault. That is the trade the user is making, and the opt-in must say so
  plainly.

**Open questions to settle first:**

- `prf` support varies by platform and browser version. Probe
  `PublicKeyCredential.getClientCapabilities()` and fall back to
  master-password-only rather than silently degrading.
- Whether to require the master password periodically anyway, so it is not
  forgotten — a password never typed is a password lost.

Until this lands, the master password is the only way in, which is why
onboarding pushes so hard on choosing one that will be remembered.

---

## Done

Stages 1 to 5 are complete. Working today:

- Encrypted vault, auto-lock, master password change
- Autofill on page load, in-field badge with a login picker
- Save prompt that survives a navigation and only asks when something changed
- Two-factor: QR scanning, key parsing, live codes, verification-page fill
- Password generator, as a page and inside the badge menu
- Security score, opt-in breach checking
- Encrypted backup, restore, and importers for the major managers
- Settings for everything above
- **Trash with undo** — deleting is reversible, and nothing is purged on a timer
- **Watchtower** — every weak, reused, breached or stale password, grouped by
  problem, each one a click from the item that causes it
- **Change a password from the finding that reports it** — generates a
  replacement and opens the site's `/.well-known/change-password` page
- **Touch ID unlock** — WebAuthn PRF wraps the vault key to the device, prompts
  on its own, and the master password always still works
- **Release notifications** — Chrome never updates a folder-loaded extension,
  so it asks GitHub once a day whether a newer release exists
- **Recovery kit** — a printable sheet carrying a vault ID and no secrets
- **End-to-end tests** — Playwright against a real Chromium with the extension
  installed, which found a live bug in the trust boundary on its first run
- **Pinned extension ID** — a manifest key, so moving the folder no longer
  produces a new ID and an apparently empty vault
- **API credentials** — keys and tokens with environment, expiry and hostname,
  and the issuer named from the key's own prefix without asking anyone
- **SSH keys** — with the fingerprint `ssh-keygen -lf` prints, derived locally
  and verified against the real thing
- **Custom fields** — typed sections; hidden values are masked, excluded from
  search, and stripped before an item crosses into a page
- **Tags** — folded case-insensitively, so `Work` and `work` stay one tag
- **Archive** — keep an item without it ever being offered to a login form
  again, separate from the trash, and nothing in it expires
- **Missing two-factor** — logins on sites known to support a second factor
  where no code is stored, checked against a bundled list rather than by
  asking anyone which sites you use

## To do

Ordered by what would be felt first.

### 1. Encrypted sync

The largest remaining gap: one machine, one vault, and an export as the only
backup. **Designed, not built** —
[`docs/design/2026-08-25-encrypted-sync.md`](docs/design/2026-08-25-encrypted-sync.md).

The transport recommendation is a file the user picks inside a folder their
machine already syncs, which adds no OAuth, no permission and no network
request. The hard part is the merge, and the model turned out to be most of
the way there already: soft deletion and soft archiving are tombstones, and a
hard delete would have been unmergeable.

Ships in phases; phase one is a manual **Sync now**, which on its own is
automated encrypted backup into a folder that already leaves the machine.

### 2. Travel Mode

**Designed, deliberately unbuilt** —
[`docs/design/2026-08-25-travel-mode.md`](docs/design/2026-08-25-travel-mode.md).

It removes data from the only place that data exists, so it wants a real
restore path first — which is sync. The design also records two things found
by reading the code: `storage.js` keeps a rotating copy of the previous vault
that any naive implementation would leave behind, and `chrome.storage.local`
is LevelDB, so deletion is not erasure.

### 3. Item types beyond logins

Cards, identities and documents can be created but are given login fields.
Each needs its own shape — a card wants a number, expiry and security code —
and the sidebar categories stay half-real until they have one.

### 4. Duplicate detection

An import from another manager leaves near-duplicates. Find them and offer a
merge. Worth doing before sync rather than after, since sync will make more
of them.

### 5. A command palette

Search, jump to an entry, copy a password, generate one — without the mouse.

### 6. Show a QR to move a credential to a phone

The reverse of scanning. Needs a QR _encoder_, a few hundred lines, with no
dependency worth taking for it.

### 7. Multiple vaults

Separate vaults with separate keys, rather than one vault with tags. A real
change to the model: every list, match and score gains a scope, and the
migration of an existing vault is the delicate part.

### 8. Folders

The data model carries them and nothing uses them. Tags cover most of what
they would be for, so this may stay unbuilt on purpose.

### 9. Change the master password from the UI

The handler exists and is tested; there is no way to reach it.

### 10. Per-site rules

"Never autofill here", for the handful of sites where it misbehaves.

## Before any public release

- [ ] Third-party security review — the "not yet audited" warning stays in the
      README until this happens
- [x] Playwright end-to-end suite with the extension actually loaded
- [ ] Reproducible build, with the crypto core left unminified so a reviewer can
      audit the shipped bytes
- [ ] Chrome Web Store listing, privacy policy, and permission justifications
- [ ] Accessibility pass: keyboard-only navigation, screen reader labels,
      contrast

---

## Deliberately out of scope

Listed so these are understood as decisions rather than oversights.

| Excluded                               | Reason                                                                |
| -------------------------------------- | --------------------------------------------------------------------- |
| Server-side sync, shared vaults, teams | Requires a backend, which is the thing this project is built to avoid |
| Firefox and Safari                     | Different extension APIs; revisit once Chrome is stable               |
| Passkeys / WebAuthn storage            | Substantial separate design effort                                    |
| `otpauth-migration://` bulk import     | Protobuf payload; a v2 candidate                                      |
| Argon2id key derivation                | WASM conflicts with CSP and bundle size — revisit if that changes     |
