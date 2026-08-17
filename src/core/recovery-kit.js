import { toHex, fromBase64 } from './encoding.js';

/**
 * The recovery kit: a sheet of paper that survives your computer.
 *
 * KeyVault has exactly one unrecoverable failure. Not disk loss — a backup
 * covers that. Not theft — the vault is encrypted. It is forgetting the
 * master password, because there is nobody holding a second key and no reset
 * link to click. At that point the entries are gone in the strict sense:
 * nobody, including the author of this program, can get them back.
 *
 * Software cannot solve that. What it can do is make the one thing that does
 * solve it — writing the password down and putting it somewhere safe — easy
 * and obvious, rather than something people mean to do and never get round
 * to. This is the same reasoning behind 1Password's Emergency Kit.
 *
 * What this file must never do is put a secret on that page. The kit is
 * designed to be printed, and a printed page passes through a print spooler,
 * possibly a shared printer, and ends up in a drawer. So it carries no
 * password, no key, no entry, and nothing derived from any of them. The
 * password goes on the page in the user's own handwriting or not at all.
 */

/**
 * A short, non-secret label identifying which vault a kit belongs to.
 *
 * Derived from the KDF salt, which is stored in the clear inside the vault
 * document and is not secret — its job is to make precomputation useless,
 * not to stay hidden. Hashing it anyway means the printed page does not
 * carry a verbatim copy of a cryptographic parameter, which costs nothing
 * and avoids having to explain why that is fine.
 *
 * The point is practical: after a year you may have several backup files and
 * no idea which vault each belongs to. This is how you tell.
 *
 * @param {string} saltBase64
 * @param {SubtleCrypto} [subtle]
 * @returns {Promise<string>} e.g. "A1B2-C3D4"
 */
export async function vaultFingerprint(saltBase64, subtle = globalThis.crypto.subtle) {
  const digest = await subtle.digest('SHA-256', fromBase64(saltBase64));
  const hex = toHex(new Uint8Array(digest)).toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
}

/**
 * Everything the printed kit needs.
 *
 * @param {object} options
 * @param {string} options.saltBase64 from the vault document
 * @param {number} options.entryCount
 * @param {string} options.version extension version
 * @param {number} [options.now]
 * @returns {Promise<object>}
 */
export async function buildRecoveryKit({ saltBase64, entryCount, version, now = Date.now() }) {
  return {
    fingerprint: await vaultFingerprint(saltBase64),
    entryCount,
    version,
    generatedAt: now,
  };
}

/**
 * Does this object contain anything that must not be printed?
 *
 * Exported because it is the guarantee this module exists to make, and a
 * guarantee nobody can check is not one. The UI calls it before rendering,
 * so a future field added carelessly upstream fails loudly here rather than
 * appearing quietly on a piece of paper.
 *
 * @param {object} kit
 * @returns {string[]} the names of any forbidden fields present
 */
export function forbiddenFieldsIn(kit) {
  const forbidden = [
    'password',
    'masterPassword',
    'secret',
    'key',
    'totp',
    'entries',
    'username',
    'notes',
    'data',
    'ciphertext',
    'verifier',
  ];
  const found = [];
  const walk = (value, path) => {
    if (value === null || typeof value !== 'object') {
      return;
    }
    for (const [name, child] of Object.entries(value)) {
      const lower = name.toLowerCase();
      if (forbidden.some((term) => lower === term || lower.endsWith(term))) {
        found.push(path === '' ? name : `${path}.${name}`);
      }
      walk(child, path === '' ? name : `${path}.${name}`);
    }
  };
  walk(kit, '');
  return found;
}
