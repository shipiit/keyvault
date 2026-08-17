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

Stages 1 to 3 are complete, and most of stage 4. Working today:

- Encrypted vault, auto-lock, master password change
- Autofill on page load, in-field badge with a login picker
- Save prompt that survives a navigation and only asks when something changed
- Two-factor: QR scanning, key parsing, live codes, verification-page fill
- Password generator, as a page and inside the badge menu
- Security score, opt-in breach checking
- Encrypted backup, restore, and importers for the major managers
- Settings for everything above

## To do

Ordered by what would be felt first.

### 1. Trash with undo

Deleting is permanent, and nothing holds a copy. This is the only remaining
way to lose data through ordinary use, so it goes first. Soft-delete with a
`deletedAt` stamp, a Trash view that restores, and a purge that is explicit.

### 2. End-to-end tests

The largest gap in the project. Six hundred tests, none of which load the
extension in a browser — and every bug found in real use was of a kind they
structurally could not catch: a blank popup from absolute asset paths, an
`import` in a content script, a save prompt lost to a message sent during
unload, a two-factor secret read from the page heading. Playwright with the
extension loaded, covering the flows a person actually performs.

### 3. Watchtower view

The security score is computed but not clickable. The weak, reused and
breached lists exist in the data and have nowhere to be shown.

### 4. Show a QR to move a credential to a phone

The reverse of scanning. Needs a QR _encoder_, which is a few hundred lines
and has no dependency worth taking for it.

### 5. Item types beyond logins

Cards, identities and documents can be created but are given login fields.
Each needs its own shape — a card wants a number, expiry and security code.

### 6. Folders

The data model carries them and nothing uses them.

### 7. Change the master password from the UI

The handler exists and is tested; there is no way to reach it.

### 8. Touch ID unlock

Built but unproven — see above. It needs a working PRF-capable authenticator,
and if Chrome's macOS one cannot do it, the honest resolution is to remove
the feature rather than leave a button that fails.

## Before any public release

- [ ] Third-party security review — the "not yet audited" warning stays in the
      README until this happens
- [ ] Playwright end-to-end suite with the extension actually loaded
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
