import { toHex } from './encoding.js';

/**
 * The k-anonymity protocol behind breach checking.
 *
 * These are pure functions — this module makes no network request, in keeping
 * with the rule that `src/core/` never touches I/O. The fetch lives in
 * `src/background/breach-service.js`, which is the only place in the codebase
 * that talks to a network at all.
 *
 * ## Why this is safe to do at all
 *
 * Checking a password against a breach corpus naively would mean sending the
 * password — or a full hash of it, which is equivalent for a known-plaintext
 * corpus — to somebody else's server. That is unacceptable for a
 * zero-knowledge password manager.
 *
 * The k-anonymity range protocol avoids it. The client hashes the password
 * with SHA-1 and sends only the **first five hex characters** of that hash.
 * The server replies with every hash suffix it holds under that prefix —
 * typically several hundred to a thousand — and the client matches locally.
 *
 * The server therefore learns a 20-bit prefix shared by roughly one in a
 * million passwords, and cannot tell which of the candidates was checked, or
 * even whether the answer was a hit. This is the same mechanism 1Password,
 * Bitwarden, and Chrome's own leak detection use.
 *
 * SHA-1 is used because it is the protocol's wire format, not because it is a
 * good hash. Nothing here depends on its collision resistance: it is an index
 * into a public corpus, never a security boundary.
 */

/** Characters of hash prefix sent to the server. Fixed by the protocol. */
export const PREFIX_LENGTH = 5;

/**
 * Split a password's SHA-1 hash into the prefix that may be sent and the
 * suffix that must not be.
 *
 * @param {string} password
 * @returns {Promise<{prefix: string, suffix: string}>} uppercase hex
 */
export async function hashForRangeQuery(password) {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password));
  const hex = toHex(new Uint8Array(digest)).toUpperCase();
  return { prefix: hex.slice(0, PREFIX_LENGTH), suffix: hex.slice(PREFIX_LENGTH) };
}

/**
 * Find our suffix in the server's response.
 *
 * The response is newline-delimited `SUFFIX:COUNT`. Matching happens here,
 * locally — the server never learns which line, if any, we were looking for.
 *
 * @param {string} responseText
 * @param {string} suffix uppercase hex
 * @returns {{breached: boolean, occurrences: number}}
 */
export function findSuffix(responseText, suffix) {
  if (typeof responseText !== 'string') {
    return { breached: false, occurrences: 0 };
  }
  for (const line of responseText.split('\n')) {
    const separator = line.indexOf(':');
    if (separator === -1) {
      continue;
    }
    if (line.slice(0, separator).trim().toUpperCase() === suffix) {
      const count = Number.parseInt(line.slice(separator + 1).replace(/\D/g, ''), 10);
      return { breached: true, occurrences: Number.isNaN(count) ? 1 : count };
    }
  }
  return { breached: false, occurrences: 0 };
}

/**
 * Turn an occurrence count into advice.
 *
 * The count is how many times the password appears across all known breach
 * corpora. It is *not* a statement that the user's own account was breached —
 * conflating those is the most common way this feature misleads people. A
 * password appearing in a corpus means it is in every attacker's wordlist,
 * which is the actual risk, whether or not it leaked from a site they use.
 *
 * @param {number} occurrences
 * @returns {{severity: 'none'|'low'|'high'|'critical', title: string, detail: string}}
 */
export function describeExposure(occurrences) {
  if (occurrences <= 0) {
    return {
      severity: 'none',
      title: 'Not found in any known breach',
      detail:
        'This password does not appear in the public breach corpus. That is not proof it is ' +
        'safe, only that it has not been seen leaking.',
    };
  }
  // The count is of *accounts*, and naming them is what stops the number
  // being read as "you were breached 14,601 times". Almost every one of them
  // belongs to a stranger who happened to choose the same password, which is
  // why this can read as alarming while a search for the user's own email
  // comes back completely clean. Both are true at once, and the phrasing has
  // to survive being read on its own, without the explanation underneath.
  if (occurrences < 10) {
    return {
      severity: 'low',
      title: `Found in ${occurrences} breached account${occurrences === 1 ? '' : 's'}`,
      detail:
        'Other people chose this same password, and their accounts leaked. That puts it in ' +
        'attacker wordlists, so it is now guessable whether or not you were ever breached. ' +
        'Change it wherever you use it.',
    };
  }
  if (occurrences < 10000) {
    return {
      severity: 'high',
      title: `Found in ${occurrences.toLocaleString()} breached accounts`,
      detail:
        'That many other people picked this same password and had it leak. It is well known to ' +
        'attackers and would be tried early in any credential stuffing attack — not because ' +
        'your account leaked, but because the password itself is now public. Change it now.',
    };
  }
  return {
    severity: 'critical',
    title: `Found in ${occurrences.toLocaleString()} breached accounts`,
    detail:
      'This is among the most commonly chosen passwords in existence, which is why so many ' +
      'other people had it leak. An attacker guessing it needs no breach of yours at all — it ' +
      'sits near the top of every wordlist. Change it immediately.',
  };
}
