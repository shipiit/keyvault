# Security Policy

## Reporting a Vulnerability

Please do not open a public issue for security vulnerabilities. Report them
privately via GitHub's "Report a vulnerability" flow on this repository.
Expect an acknowledgement within 72 hours.

## Design

KeyVault is local-only and zero-knowledge. See
`docs/superpowers/specs/2026-08-17-keyvault-password-manager-design.md`
for the full threat model.

- Vault encryption: AES-GCM-256
- Key derivation: PBKDF2-SHA256, 600,000 iterations, per-vault random salt
- The master password and derived key are never persisted to disk
- The extension makes no network requests of any kind

## Scope

In scope: vault encryption, key handling, autofill target matching, TOTP
correctness, the extension's message boundary.

Out of scope: a compromised operating system, keyloggers, other malicious
extensions with `debugger` permissions, and physical access to an unlocked
browser.
