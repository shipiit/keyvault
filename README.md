# KeyVault

A local-only, zero-knowledge password manager for Chrome. Stores credentials and
TOTP secrets in an encrypted vault that never leaves your machine.

## Status

**Under active development. Not yet audited. Do not use for real credentials.**

## Security

The vault is encrypted with AES-GCM-256 under a key derived from your master
password via PBKDF2-SHA256 at 600,000 iterations. The master password and the
derived key are never written to disk. The extension makes no network requests
of any kind.

See [`SECURITY.md`](SECURITY.md) for the threat model and vulnerability
reporting, and
[`docs/superpowers/specs/2026-08-17-keyvault-password-manager-design.md`](docs/superpowers/specs/2026-08-17-keyvault-password-manager-design.md)
for the full design.

`src/core/` — the security-critical layer — has no runtime dependencies and no
browser APIs, so the cryptography can be audited with `npm test` alone.

## Development

```sh
npm install
npm test              # run the suite
npm run test:watch    # watch mode
npm run test:coverage # with enforced coverage thresholds
npm run lint
npm run format
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) before changing anything under
`src/core/`.

## License

MIT
