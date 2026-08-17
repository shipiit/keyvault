# Security Policy

## Reporting a Vulnerability

Please do not open a public issue for security vulnerabilities. Report them
privately via GitHub's "Report a vulnerability" flow on this repository.
Expect an acknowledgement within 72 hours.

## Design

KeyVault is local-only and zero-knowledge. See `README.md` for the full threat
model and the reasoning behind each design decision.

- Vault encryption: AES-GCM-256
- Key derivation: PBKDF2-SHA256, 600,000 iterations, per-vault random salt
- The master password and derived key are never persisted to disk
- The extension makes no network requests by default. The sole exception is
  optional breach checking, which is off until enabled and which sends only a
  five-character hash prefix (k-anonymity range protocol) — never a password,
  full hash, username, or URL. Its host permission is declared optional, so a
  default install has no network reach.

## Scope

In scope: vault encryption, key handling, autofill target matching, TOTP
correctness, the extension's message boundary, and the privacy properties of
the optional breach check.

Out of scope: a compromised operating system, keyloggers, other malicious
extensions with `debugger` permissions, and physical access to an unlocked
browser.
