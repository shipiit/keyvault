/**
 * Offline password strength estimation.
 *
 * Entirely local — no network, no dependency. The estimate is deliberately
 * conservative: it reports the entropy an attacker would face if they knew
 * the *pattern* the password follows, not the naive `log2(charset^length)`
 * figure, which flatters passwords like `Password123!` badly.
 *
 * This is guidance, not a gate. The only hard rule lives in the vault
 * service's minimum length.
 */

/**
 * Passwords that appear at the very top of every breach corpus. A full
 * dictionary belongs in the breach check, which queries a real corpus of
 * hundreds of millions; this list only catches the most embarrassing cases
 * instantly and offline, before the user has even finished typing.
 */
const NOTORIOUS = new Set([
  'password',
  'password1',
  'password123',
  '123456',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty',
  'qwerty123',
  'abc123',
  'letmein',
  'welcome',
  'monkey',
  'dragon',
  'iloveyou',
  'admin',
  'admin123',
  'root',
  'toor',
  'passw0rd',
  'p@ssw0rd',
  'trustno1',
  'sunshine',
  'princess',
  'football',
  'baseball',
  'superman',
  'master',
  'shadow',
  'michael',
  'changeme',
]);

const CHARSETS = [
  { test: /[a-z]/, size: 26 },
  { test: /[A-Z]/, size: 26 },
  { test: /\d/, size: 10 },
  { test: /[ !-/:-@[-`{-~]/, size: 33 },
];

/**
 * Bits of entropy, discounted for structure an attacker can exploit.
 *
 * @param {string} password
 * @returns {number}
 */
export function estimateEntropyBits(password) {
  if (password.length === 0) {
    return 0;
  }

  const alphabet = CHARSETS.reduce(
    (sum, { test, size }) => (test.test(password) ? sum + size : sum),
    0,
  );
  let bits = password.length * Math.log2(alphabet || 1);

  // Repeated characters ("aaaaaa") carry far less information than their
  // length suggests.
  const distinct = new Set(password).size;
  if (distinct < password.length) {
    bits *= distinct / password.length;
  }

  // Sequential runs — "abcdef", "123456", keyboard walks — are the first
  // thing every cracking rule tries.
  if (hasSequentialRun(password, 4)) {
    bits -= 12;
  }

  // A capital only at the start and digits only at the end is the single most
  // common human pattern, and cracking rules encode it directly.
  if (/^[A-Z][a-z]+\d+[!@#$%^&*]?$/.test(password)) {
    bits -= 10;
  }

  return Math.max(0, Math.round(bits));
}

function hasSequentialRun(password, minRun) {
  const lower = password.toLowerCase();
  let ascending = 1;
  let descending = 1;
  for (let i = 1; i < lower.length; i += 1) {
    const delta = lower.charCodeAt(i) - lower.charCodeAt(i - 1);
    ascending = delta === 1 ? ascending + 1 : 1;
    descending = delta === -1 ? descending + 1 : 1;
    if (ascending >= minRun || descending >= minRun) {
      return true;
    }
  }
  return false;
}

/**
 * Assess a password.
 *
 * @param {string} password
 * @returns {{score: 0|1|2|3|4, label: string, entropyBits: number, warning: string|null,
 *            suggestions: string[]}}
 */
export function assessPassword(password) {
  if (typeof password !== 'string' || password.length === 0) {
    return { score: 0, label: 'Empty', entropyBits: 0, warning: null, suggestions: [] };
  }

  const normalised = password.toLowerCase().replace(/[!@#$%^&*]+$/, '');
  const entropyBits = estimateEntropyBits(password);
  const suggestions = [];
  let warning = null;

  if (NOTORIOUS.has(normalised)) {
    return {
      score: 0,
      label: 'Very weak',
      entropyBits: 0,
      warning: 'This is one of the most common passwords in existence.',
      suggestions: ['Pick something unrelated to a dictionary word.'],
    };
  }

  if (password.length < 12) {
    suggestions.push('Make it longer — length matters more than symbols.');
  }
  if (hasSequentialRun(password, 4)) {
    warning = 'Contains a predictable run of characters.';
  }
  if (/^[a-z]+$/.test(password)) {
    suggestions.push('Mix in capitals, digits, or symbols.');
  }
  if (/^\d+$/.test(password)) {
    warning = 'Digits alone are cracked almost instantly.';
  }

  const score =
    entropyBits < 28 ? 0 : entropyBits < 42 ? 1 : entropyBits < 60 ? 2 : entropyBits < 90 ? 3 : 4;

  return {
    score,
    label: ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'][score],
    entropyBits,
    warning,
    suggestions,
  };
}

/**
 * A rough, honest time-to-crack figure.
 *
 * Assumes offline attack against a fast hash at 10^11 guesses/second — the
 * pessimistic case, which is the right one to show a user. A vault protected
 * by 600k-iteration PBKDF2 is far slower to attack than this, so the figure
 * understates safety deliberately rather than overstating it.
 *
 * @param {number} entropyBits
 * @returns {string}
 */
export function timeToCrack(entropyBits) {
  const guessesPerSecond = 1e11;
  const seconds = 2 ** (entropyBits - 1) / guessesPerSecond;

  const units = [
    ['centuries', 3.156e9],
    ['years', 3.156e7],
    ['months', 2.628e6],
    ['days', 86400],
    ['hours', 3600],
    ['minutes', 60],
  ];
  if (seconds < 1) {
    return 'instantly';
  }
  for (const [name, size] of units) {
    if (seconds >= size) {
      const value = seconds / size;
      return value > 1e6 ? `over a million ${name}` : `about ${Math.round(value)} ${name}`;
    }
  }
  return `about ${Math.round(seconds)} seconds`;
}
