# KeyVault

A local-only, zero-knowledge password manager for Chrome. Stores credentials and
TOTP two-factor secrets in an encrypted vault that never leaves your machine.

> **Status: under active development. Not yet audited. Do not use for real
> credentials.**
>
> The cryptographic core is complete and tested. The extension itself — manifest,
> service worker, UI, autofill — is not built yet. See
> [Project status](#project-status) for exactly what exists.

---

## Why another password manager

Most browser password managers ask you to trust a server. KeyVault has no server
to trust: there is no backend, no account, no telemetry, and no network code
anywhere in the extension. Your vault is a single encrypted blob in your own
browser's storage.

That design has a real cost, stated plainly: **if you forget your master
password, your vault is unrecoverable.** There is no reset link, because there is
nobody holding a key to reset it with. Export a backup as soon as you create a
vault.

---

## Planned features

|                        |                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| **Encrypted vault**    | AES-GCM-256 under a PBKDF2-derived key. Auto-locks on a timer and on browser close.                   |
| **Autofill**           | Detects login forms and fills them, including React/Vue apps that ignore naive value assignment.      |
| **Save prompt**        | Offers to save or update a credential after you log in.                                               |
| **Auto-login**         | Opt-in **per credential**, off by default. See [Security](#security).                                 |
| **TOTP 2FA**           | Scan a QR code, upload a QR image, or paste an `otpauth://` URI. Live 6-digit codes with a countdown. |
| **Password generator** | Configurable length and character classes, built on a bias-free CSPRNG.                               |
| **Import / export**    | Encrypted backup files, plus importers for 1Password, Bitwarden, LastPass, and Chrome CSV.            |

---

## Security

### How the vault is protected

| Layer          | Choice                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------- |
| Encryption     | AES-GCM-256, fresh random 96-bit IV per write                                               |
| Key derivation | PBKDF2-SHA256, 600,000 iterations, 16-byte per-vault salt                                   |
| Unlock check   | Two-stage verifier record — never a stored password or password hash                        |
| At rest        | `chrome.storage.local` only. Never `chrome.storage.sync`, which round-trips through Google. |
| In memory      | The derived key is never written to disk and is cleared when the browser closes             |
| Network        | None. The extension makes no outbound requests of any kind.                                 |
| CSP            | `script-src 'self'` — no remote code, no `eval`                                             |

### Design decisions worth knowing about

**Auto-login is opt-in per credential, and off by default.** This is deliberate.
A look-alike domain, a third-party iframe, or a login form injected into a
compromised page can all harvest whatever gets filled and submitted
automatically. Autofill matches on the registrable domain, never fills
cross-origin iframes without an explicit per-site opt-in, and will not submit a
form unless you have ticked that box for that specific entry. 1Password and
Bitwarden both refuse to auto-submit by default for the same reason.

**Search never reads your secrets.** The search box matches on title, username,
URL, and tags only — never passwords, notes, or TOTP secrets. Including them
would turn search into an oracle: anyone at your unlocked browser could type a
guessed password and watch for a match, and secrets would surface in result
lists.

**Random number generation uses rejection sampling.** Reducing random values with
`%` is biased whenever the range is not a power of two. For a password generator
that is a measurable loss of entropy, so bounded integers discard out-of-range
draws instead. There is a statistical test enforcing this.

**PBKDF2 rather than Argon2id.** Argon2id resists GPU cracking better, but needs
a WebAssembly binary, which conflicts with the extension's content-security
policy and materially increases bundle size. 600,000-iteration PBKDF2-SHA256 is
what Bitwarden's browser extension ships and meets the OWASP minimum. Measured
unlock cost is ~157 ms.

### Threat model

**Protects against:** someone who obtains your encrypted vault file, a malicious
web page trying to read the vault or the key, phishing sites trying to harvest
autofilled credentials, and a stranger at your unattended unlocked browser.

**Does not protect against:** a compromised operating system, a keylogger
capturing your master password as you type it, another malicious extension
holding `debugger` permission, or anyone who knows your master password.

Full detail and vulnerability reporting: [`SECURITY.md`](SECURITY.md).

---

## Project status

The work is split into four stages, each of which produces something verifiable
on its own.

| Stage                   | Contents                                                      | Status                                            |
| ----------------------- | ------------------------------------------------------------- | ------------------------------------------------- |
| **1 — Core**            | Crypto, TOTP, vault data model, CI                            | ✅ **Complete** — 179 tests, 100% branch coverage |
| **2 — Runtime**         | Service worker, storage, lock lifecycle, messaging            | ⛔ Blocked — see [`ROADMAP.md`](ROADMAP.md)       |
| **3 — UI**              | Design tokens, popup, onboarding, vault page, generator       | ⬜ Not started                                    |
| **4 — Web integration** | Autofill, save prompt, auto-login, QR scanning, import/export | ⬜ Not started                                    |

**What this means today:** `npm test` passes and the security library is real and
audited by its own test suite, but there is no `manifest.json` yet, so there is
nothing to load into Chrome. Stage 2 is blocked on one unresolved platform
question — details and the exact probe to run are in
[`ROADMAP.md`](ROADMAP.md).

### What is built

```
src/core/
├── errors.js       Typed errors — a wrong password never surfaces as a raw crypto error
├── encoding.js     UTF-8, base64, base64url, hex, byte concatenation
├── random.js       CSPRNG with bias-free bounded integers
├── kdf.js          PBKDF2-SHA256 → AES-GCM-256 key derivation
├── cipher.js       AES-GCM encrypt/decrypt; the IV is not a caller parameter
├── seal.js         Vault document sealing and two-stage unlock
├── base32.js       RFC 4648 codec, tolerant of how people actually paste secrets
├── totp.js         RFC 6238 codes + otpauth:// parse and build
├── entry.js        Credential model with capped password history
└── vault-data.js   Vault document operations and search
```

`src/core/` has **zero runtime dependencies** and uses no browser or Chrome APIs.
ESLint enforces that. It means anyone can audit the cryptography by running
`npm test` — no browser, no build step, no extension loaded.

### How it is verified

Correctness here is established against published test vectors, not against the
implementation's own round-trips — code that encrypts and decrypts consistently
can still be consistently wrong.

- **PBKDF2** — checked against published PBKDF2-HMAC-SHA256 vectors at 1 and 4096
  iterations
- **TOTP** — all 18 RFC 6238 vectors across SHA-1, SHA-256 and SHA-512, including
  `t=20000000000`, which catches a 32-bit counter overflow that would silently
  produce wrong codes after 2038
- **Base32** — the full RFC 4648 vector set
- **AES-GCM** — asserts that encrypting identical plaintext twice never yields
  identical output, which catches a fixed or reused IV
- **Vault** — asserts no plaintext secret survives serialisation, and that a
  verifier re-encrypted by an attacker is rejected

---

## Development

```sh
npm install
npm test               # 179 tests
npm run test:watch
npm run test:coverage  # thresholds enforced: 95% lines/functions, 90% branches
npm run lint
npm run format
```

Requires Node 20 or newer. CI runs on Node 20, 22 and 24, and fails on any
`npm audit` finding at moderate or above.

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before changing anything under
`src/core/` — cryptographic changes have extra requirements.

---

## Documentation

| Document                                             | Contents                                                |
| ---------------------------------------------------- | ------------------------------------------------------- |
| [`ROADMAP.md`](ROADMAP.md)                           | What is left to build, in order, and the open questions |
| [`SECURITY.md`](SECURITY.md)                         | Threat model and vulnerability reporting                |
| [`CONTRIBUTING.md`](CONTRIBUTING.md)                 | Setup and the rules governing `src/core/`               |
| [`docs/superpowers/specs/`](docs/superpowers/specs/) | Full design specification                               |
| [`docs/superpowers/plans/`](docs/superpowers/plans/) | Task-level implementation plans                         |

---

## License

MIT — see [`LICENSE`](LICENSE).
