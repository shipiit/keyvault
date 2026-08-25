import { describe, it, expect } from 'vitest';
import { webcrypto } from 'node:crypto';
import {
  parsePublicKey,
  fingerprint,
  inspectPrivateKey,
  weakness,
  describeSshKey,
} from '../../src/core/ssh-key.js';

/**
 * A real Ed25519 public key, and the fingerprint `ssh-keygen -lf` prints for
 * it. Public keys are not secrets — that is what makes them public — and
 * pinning a real pair is what makes the fingerprint test mean anything. The
 * matching private key was generated for this and discarded.
 */
const PUBLIC_KEY =
  'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDhYYd5leHeQBwBdaWLTvcheLUYBlC6Nfh8y2NW3iSR3 fixture@example.com';
const FINGERPRINT = 'SHA256:R71q2yC6xo/YhoX+nfh5AqtMutR+7y9SZiaTJnFbpqk';

const digest = webcrypto.subtle;

describe('parsePublicKey', () => {
  it('reads algorithm, blob and comment', () => {
    const parsed = parsePublicKey(PUBLIC_KEY);
    expect(parsed.label).toBe('Ed25519');
    expect(parsed.comment).toBe('fixture@example.com');
  });

  it('accepts a key with no comment', () => {
    const [algorithm, blob] = PUBLIC_KEY.split(' ');
    expect(parsePublicKey(algorithm + ' ' + blob).comment).toBe('');
  });

  it('keeps a comment containing spaces', () => {
    const [algorithm, blob] = PUBLIC_KEY.split(' ');
    expect(parsePublicKey(algorithm + ' ' + blob + ' laptop at home').comment).toBe(
      'laptop at home',
    );
  });

  it('rejects a line whose blob disagrees with its stated algorithm', () => {
    // Corrupt, or deliberately misleading. Both deserve a null rather than a
    // confident wrong answer about what kind of key this is.
    const [, blob] = PUBLIC_KEY.split(' ');
    expect(parsePublicKey('ssh-rsa ' + blob + ' x')).toBeNull();
  });

  it('rejects junk without throwing', () => {
    for (const value of ['', 'ssh-ed25519', 'not a key', null, 42, undefined]) {
      expect(parsePublicKey(value), String(value)).toBeNull();
    }
  });
});

describe('fingerprint', () => {
  it('matches what ssh-keygen prints for the same key', async () => {
    // Pinned against real ssh-keygen output. A fingerprint that is close but
    // not identical is worse than none: it looks right and never matches the
    // string being compared against it.
    expect(await fingerprint(PUBLIC_KEY, digest)).toBe(FINGERPRINT);
  });

  it('strips the base64 padding, as OpenSSH does', async () => {
    expect(await fingerprint(PUBLIC_KEY, digest)).not.toMatch(/=$/);
  });

  it('is null for anything unparseable', async () => {
    expect(await fingerprint('nonsense', digest)).toBeNull();
  });
});

describe('inspectPrivateKey', () => {
  it('recognises the legacy PEM formats and their encryption header', () => {
    expect(inspectPrivateKey('-----BEGIN RSA PRIVATE KEY-----\nx')).toEqual({
      format: 'PEM',
      encrypted: false,
    });
    expect(inspectPrivateKey('-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nx')).toEqual(
      {
        format: 'PEM',
        encrypted: true,
      },
    );
  });

  it('distinguishes PKCS#8 encrypted from plain', () => {
    expect(inspectPrivateKey('-----BEGIN PRIVATE KEY-----\nx').encrypted).toBe(false);
    expect(inspectPrivateKey('-----BEGIN ENCRYPTED PRIVATE KEY-----\nx').encrypted).toBe(true);
  });

  it('returns null for something that is not a private key', () => {
    for (const value of ['', '   ', 'hunter2', PUBLIC_KEY, null, undefined]) {
      expect(inspectPrivateKey(value), String(value)).toBeNull();
    }
  });
});

describe('weakness', () => {
  it('says nothing about a modern key', () => {
    expect(weakness(PUBLIC_KEY)).toBeNull();
  });

  it('is null for an unparseable key rather than a false alarm', () => {
    expect(weakness('nonsense')).toBeNull();
  });
});

describe('describeSshKey', () => {
  it('summarises the key without touching the private half', async () => {
    const described = await describeSshKey(
      {
        password: '-----BEGIN OPENSSH PRIVATE KEY-----',
        fields: { ssh: { publicKey: PUBLIC_KEY } },
      },
      digest,
    );
    expect(described.algorithm).toBe('Ed25519');
    expect(described.fingerprint).toBe(FINGERPRINT);
    expect(described.comment).toBe('fixture@example.com');
  });

  it('does not throw on an entry with no SSH fields', async () => {
    await expect(describeSshKey({}, digest)).resolves.toMatchObject({ algorithm: null });
  });
});
