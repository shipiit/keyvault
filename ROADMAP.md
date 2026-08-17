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

## Stage 3 — UI 🟡 in progress

**Done:** Tailwind v4 token layer (light/dark from one set, following the system
theme), popup shell, onboarding with the unrecoverable-vault acknowledgement,
unlock screen, searchable credential list with live TOTP and countdown ring,
offline password strength, opt-in breach checking.

**Remaining:**

- Full-page vault manager: list/detail, folders, tags, bulk actions
- Password generator UI
- Settings: auto-lock interval, per-site rules, generator defaults, breach-check
  opt-in toggle
- Entry create/edit form
- Component tests with Preact Testing Library

Original scope, for reference:

- `tokens.css` — colour, spacing, radius, shadow and motion scales. Light and
  dark derived from one token set. No hardcoded hex or raw pixel values.
- Onboarding: master password creation with a strength meter and an explicitly
  acknowledged warning that a lost master password means an unrecoverable vault
- Popup: search, entries for the current site surfaced first, one-click copy,
  live TOTP with a countdown ring, clipboard auto-clear after 30 s
- Full-page vault: list/detail, folders, tags, bulk actions
- Password generator with a live strength estimate
- Settings: auto-lock interval, per-site rules, generator defaults, theme
- Keyboard navigable throughout; motion suppressed under
  `prefers-reduced-motion`

**Done when:** the extension is usable as a manual password manager — everything
works via copy and paste, without autofill.

---

## Stage 4 — Web integration

The riskiest stage. Everything here touches untrusted pages.

**Field detection** — heuristic scoring over `autocomplete` attributes (weighted
highest), input types, `name`/`id`/`placeholder`/`aria-label`, and nearby label
text. Must handle username+password, password-only second-step logins, and
signup forms with a confirm-password field.

**Filling** — must use the native value setter:

```js
Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
el.dispatchEvent(new Event('input', { bubbles: true }));
el.dispatchEvent(new Event('change', { bubbles: true }));
```

A plain `el.value = value` does not trigger React or Vue reactivity: the field
looks filled, and the app submits an empty string. This is the single most common
autofill bug and needs a dedicated regression test against a React fixture page.

**Domain matching** — registrable domain (eTLD+1) via the Public Suffix List, so
`login.bank.com` matches `bank.com` but `bank.com.evil.co` does not.

**Save prompt** — a shadow-DOM banner, so host page styles cannot affect it.

**Auto-login** — per-entry opt-in only, never in cross-origin iframes without an
explicit per-site opt-in.

**QR scanning** — screen-region capture via `chrome.tabs.captureVisibleTab`, plus
image upload and paste. _Open question:_ Chrome's native `BarcodeDetector` is
unreliable on macOS desktop. Probe `'BarcodeDetector' in self` before building;
if absent, bundle `jsQR` (~35 KB, MIT) behind the same `decodeQr(imageData)`
interface so the choice is invisible to callers. This is the largest single
addition to bundle size.

**Import / export** — encrypted `.keyvault` files, plus importers for 1Password,
Bitwarden, LastPass and Chrome CSV, each an isolated module tested against real
fixture files.

**Security tests required before this stage ships:**

- A content script cannot read the session key
- No fill occurs on a domain mismatch
- No fill occurs in a cross-origin iframe without opt-in
- No auto-submit occurs unless that specific entry opted in

---

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
