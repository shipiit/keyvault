# Contributing to KeyVault

## Setup

```sh
npm install
npm test
```

## Rules for `src/core/`

`src/core/` is the security-critical layer. It must stay pure:

- No `chrome.*`, no DOM, no network, no filesystem, no persistent storage
- No runtime dependencies — WebCrypto only
- Every module must run unmodified in plain Node

ESLint enforces this. It exists so that any reviewer can audit the
cryptography by running `npm test`, with no browser involved.

## Cryptographic changes

Changes to `kdf.js`, `cipher.js`, `seal.js`, `base32.js`, or `totp.js`
require:

1. Known-answer tests against published vectors where they exist
2. An explanation in the pull request of what changed and why
3. A vault-format migration path if the on-disk format changes

Do not weaken a parameter — iteration count, key length, IV size — without a
written rationale. In particular:

- The AES-GCM IV must remain per-call random and must never become a
  caller-supplied parameter.
- PBKDF2 iterations must not drop below the OWASP minimum for SHA-256.
- Nothing in the search path may read `password`, `notes`, or `totp.secret`.

## Tests

Test-driven: write the failing test first, watch it fail, then implement.

Coverage thresholds are enforced in CI. If a change drops coverage, add the
missing test — do not lower the threshold to make the build pass.

## Commits

Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`). Keep commits small
and focused.
