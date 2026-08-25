/**
 * SSH keys.
 *
 * A developer's SSH key is a credential like any other, and it is the one
 * most likely to be sitting in `~/.ssh` with no record of what it opens,
 * when it was made, or which of the four keys in there is still in use.
 *
 * The useful trick this does locally is derive the fingerprint from the
 * public key. That is the string a server shows you, GitHub lists in your
 * account settings, and `ssh-keygen -l` prints — so having it here is how you
 * answer "is this the key that machine is expecting?" without going and
 * looking. It is a SHA-256 over the key blob: no network, no shelling out.
 *
 * The private key is stored as an ordinary concealed value. Nothing here
 * parses it beyond recognising its format, and nothing signs with it: an
 * agent belongs in the operating system, not in a browser extension, and
 * pretending otherwise would put signing behind a page's reach.
 */

import { fromBase64, toBase64 } from './encoding.js';

/** Key algorithms, by the prefix OpenSSH writes. */
const ALGORITHMS = Object.freeze({
  'ssh-ed25519': 'Ed25519',
  'ssh-rsa': 'RSA',
  'ssh-dss': 'DSA',
  'ecdsa-sha2-nistp256': 'ECDSA P-256',
  'ecdsa-sha2-nistp384': 'ECDSA P-384',
  'ecdsa-sha2-nistp521': 'ECDSA P-521',
  'sk-ssh-ed25519@openssh.com': 'Ed25519 (security key)',
  'sk-ecdsa-sha2-nistp256@openssh.com': 'ECDSA (security key)',
});

/**
 * Algorithms nobody should still be generating.
 *
 * DSA is fixed at 1024 bits and disabled by default in current OpenSSH; RSA
 * below 2048 is under the modern floor. Both are worth saying out loud,
 * because an old key keeps working long after it stopped being a good idea —
 * which is exactly why it is still there.
 */
const WEAK = Object.freeze({
  'ssh-dss': 'DSA keys are fixed at 1024 bits and are disabled by default in current OpenSSH.',
});

/**
 * Parse an OpenSSH public key line.
 *
 * The format is three space-separated parts: algorithm, base64 blob, and an
 * optional comment which is conventionally an email or machine name.
 *
 * @param {string} line
 * @returns {{algorithm: string, label: string, blob: string, comment: string}|null}
 */
export function parsePublicKey(line) {
  if (typeof line !== 'string') {
    return null;
  }
  const parts = line.trim().split(/\s+/);
  if (parts.length < 2) {
    return null;
  }
  const [algorithm, blob, ...rest] = parts;
  if (!Object.prototype.hasOwnProperty.call(ALGORITHMS, algorithm)) {
    return null;
  }
  // The blob must be base64, and must declare the same algorithm inside it.
  // A line claiming ssh-ed25519 with an RSA blob is either corrupt or
  // deliberately misleading, and both deserve a null.
  let decoded;
  try {
    decoded = fromBase64(blob);
  } catch {
    return null;
  }
  if (!blobDeclares(decoded, algorithm)) {
    return null;
  }
  return {
    algorithm,
    label: ALGORITHMS[algorithm],
    blob,
    comment: rest.join(' '),
  };
}

/**
 * Does the key blob's own header match the algorithm on the line?
 *
 * OpenSSH blobs begin with a 4-byte big-endian length followed by the
 * algorithm name, repeating what the line already said.
 *
 * @param {Uint8Array} bytes
 * @param {string} algorithm
 */
function blobDeclares(bytes, algorithm) {
  if (bytes.length < 4) {
    return false;
  }
  const length = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
  if (length <= 0 || length > 64 || bytes.length < 4 + length) {
    return false;
  }
  let name = '';
  for (let i = 0; i < length; i += 1) {
    name += String.fromCharCode(bytes[4 + i]);
  }
  return name === algorithm;
}

/**
 * The SHA-256 fingerprint, in the form OpenSSH prints.
 *
 * `SHA256:` followed by unpadded base64 — the same string `ssh-keygen -lf`
 * gives, and the one GitHub shows beside a key.
 *
 * @param {string} line an OpenSSH public key
 * @param {SubtleCrypto} [subtle]
 * @returns {Promise<string|null>}
 */
export async function fingerprint(line, subtle = globalThis.crypto.subtle) {
  const parsed = parsePublicKey(line);
  if (parsed === null) {
    return null;
  }
  const digest = await subtle.digest('SHA-256', fromBase64(parsed.blob));
  // OpenSSH strips the padding. Leaving it on produces a string that looks
  // right and never matches what the user is comparing against.
  return `SHA256:${toBase64(new Uint8Array(digest)).replace(/=+$/, '')}`;
}

/**
 * What kind of private key this is, and whether it is passphrase-protected.
 *
 * @param {string} text
 * @returns {{format: string, encrypted: boolean|null}|null}
 */
export function inspectPrivateKey(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return null;
  }
  const body = text.trim();

  if (body.includes('BEGIN OPENSSH PRIVATE KEY')) {
    // The modern format encodes its cipher inside the base64 body. An
    // unencrypted key names the cipher "none"; anything else is encrypted.
    const base64 = body
      .split('\n')
      .filter((l) => !l.startsWith('-----'))
      .join('');
    let encrypted = null;
    try {
      const bytes = fromBase64(base64);
      const header = new TextDecoder().decode(bytes.slice(0, 64));
      encrypted = header.includes('none') ? false : true;
    } catch {
      encrypted = null;
    }
    return { format: 'OpenSSH', encrypted };
  }

  if (body.includes('BEGIN RSA PRIVATE KEY') || body.includes('BEGIN DSA PRIVATE KEY')) {
    // The legacy PEM format announces encryption in plain headers.
    return { format: 'PEM', encrypted: body.includes('ENCRYPTED') };
  }
  if (body.includes('BEGIN EC PRIVATE KEY')) {
    return { format: 'PEM (EC)', encrypted: body.includes('ENCRYPTED') };
  }
  if (body.includes('BEGIN PRIVATE KEY')) {
    return { format: 'PKCS#8', encrypted: false };
  }
  if (body.includes('BEGIN ENCRYPTED PRIVATE KEY')) {
    return { format: 'PKCS#8', encrypted: true };
  }
  return null;
}

/**
 * Anything worth warning about, given a public key.
 *
 * @param {string} publicKey
 * @returns {string|null}
 */
export function weakness(publicKey) {
  const parsed = parsePublicKey(publicKey);
  if (parsed === null) {
    return null;
  }
  return WEAK[parsed.algorithm] ?? null;
}

/**
 * Everything the UI needs about a stored SSH key.
 *
 * @param {object} entry
 * @param {SubtleCrypto} [subtle]
 */
export async function describeSshKey(entry, subtle = globalThis.crypto.subtle) {
  const ssh = entry?.fields?.ssh ?? {};
  const publicKey = ssh.publicKey ?? '';
  const parsed = parsePublicKey(publicKey);

  return {
    algorithm: parsed?.label ?? null,
    comment: parsed?.comment ?? '',
    fingerprint: parsed === null ? null : await fingerprint(publicKey, subtle),
    privateKey: inspectPrivateKey(entry?.password ?? ''),
    warning: weakness(publicKey),
  };
}
