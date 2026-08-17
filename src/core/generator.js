import { randomInt, pickRandom } from './random.js';

/**
 * Password and passphrase generation.
 *
 * Built on `randomInt`, which uses rejection sampling rather than modulo
 * reduction. That distinction matters here more than anywhere else in the
 * codebase: a biased generator quietly produces weaker passwords than its
 * length implies, and nothing about the output looks wrong.
 */

const LOWERCASE = 'abcdefghijkmnopqrstuvwxyz';
const UPPERCASE = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.?';

/** Characters people misread when transcribing: l/I/1, O/0. */
const AMBIGUOUS_LOWER = 'l';
const AMBIGUOUS_UPPER = 'IO';
const AMBIGUOUS_DIGITS = '01';

export const DEFAULT_OPTIONS = Object.freeze({
  length: 20,
  uppercase: true,
  lowercase: true,
  digits: true,
  symbols: true,
  avoidAmbiguous: true,
});

export const MIN_LENGTH = 8;
export const MAX_LENGTH = 128;

/**
 * The character pools enabled by a set of options.
 *
 * @param {object} options
 * @returns {string[]} one string per enabled class
 */
function poolsFor(options) {
  const pools = [];
  if (options.lowercase) {
    pools.push(options.avoidAmbiguous ? LOWERCASE : LOWERCASE + AMBIGUOUS_LOWER);
  }
  if (options.uppercase) {
    pools.push(options.avoidAmbiguous ? UPPERCASE : UPPERCASE + AMBIGUOUS_UPPER);
  }
  if (options.digits) {
    pools.push(options.avoidAmbiguous ? DIGITS : DIGITS + AMBIGUOUS_DIGITS);
  }
  if (options.symbols) {
    pools.push(SYMBOLS);
  }
  return pools;
}

/**
 * Generate a random password.
 *
 * Guarantees at least one character from every enabled class, then fills the
 * remainder from the combined pool and shuffles. Without the guarantee, a
 * 12-character password with symbols enabled contains no symbol roughly one
 * time in forty — and is then rejected by the site's own policy, which users
 * experience as the generator being broken.
 *
 * @param {object} [options]
 * @returns {string}
 */
export function generatePassword(options = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options };

  if (
    !Number.isInteger(config.length) ||
    config.length < MIN_LENGTH ||
    config.length > MAX_LENGTH
  ) {
    throw new RangeError(`length must be an integer between ${MIN_LENGTH} and ${MAX_LENGTH}`);
  }

  const pools = poolsFor(config);
  if (pools.length === 0) {
    throw new RangeError('at least one character class must be enabled');
  }

  const combined = pools.join('');
  const characters = pools.map((pool) => pickRandom(pool));
  while (characters.length < config.length) {
    characters.push(pickRandom(combined));
  }

  return shuffle(characters).join('');
}

/**
 * Fisher-Yates, drawing from the CSPRNG.
 *
 * The guaranteed characters are placed first, so without a shuffle every
 * password would start with one character from each class in a fixed order —
 * a pattern an attacker could exploit directly.
 *
 * @param {string[]} items mutated in place
 * @returns {string[]}
 */
function shuffle(items) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/**
 * Words for passphrase generation.
 *
 * A short, curated list rather than a full EFF wordlist: bundling ~7,776
 * words costs about 60KB, and this generator's job is a memorable fallback,
 * not the primary path. The entropy is reported honestly by
 * `passphraseEntropyBits` so the trade-off is visible rather than hidden.
 */
const WORDS = [
  'anchor',
  'basket',
  'canyon',
  'dagger',
  'ember',
  'falcon',
  'gadget',
  'harbor',
  'island',
  'jacket',
  'kernel',
  'lantern',
  'marble',
  'nectar',
  'orbit',
  'pepper',
  'quartz',
  'ribbon',
  'saddle',
  'timber',
  'umbra',
  'velvet',
  'walnut',
  'xenon',
  'yonder',
  'zephyr',
  'amber',
  'bronze',
  'cobalt',
  'dune',
  'echo',
  'fern',
  'glacier',
  'hollow',
  'ivory',
  'jungle',
  'kettle',
  'ledger',
  'meadow',
  'nimbus',
  'onyx',
  'prairie',
  'quiver',
  'rustic',
  'summit',
  'tundra',
  'urchin',
  'vessel',
  'willow',
  'yarrow',
  'zenith',
  'antler',
  'beacon',
  'cinder',
  'drifter',
  'elder',
  'fathom',
  'granite',
  'hazel',
  'indigo',
  'juniper',
  'kindle',
  'lumen',
  'mosaic',
];

export const MIN_WORDS = 3;
export const MAX_WORDS = 12;

/**
 * Generate a passphrase.
 *
 * @param {{words?: number, separator?: string, capitalize?: boolean, includeNumber?: boolean}} [options]
 * @returns {string}
 */
export function generatePassphrase({
  words = 4,
  separator = '-',
  capitalize = false,
  includeNumber = false,
} = {}) {
  if (!Number.isInteger(words) || words < MIN_WORDS || words > MAX_WORDS) {
    throw new RangeError(`words must be an integer between ${MIN_WORDS} and ${MAX_WORDS}`);
  }

  const chosen = Array.from({ length: words }, () => {
    const word = pickRandom(WORDS);
    return capitalize ? word[0].toUpperCase() + word.slice(1) : word;
  });

  if (includeNumber) {
    // Appended to a random word rather than always the last, so the digit's
    // position carries entropy too.
    const index = randomInt(chosen.length);
    chosen[index] = `${chosen[index]}${randomInt(10)}`;
  }

  return chosen.join(separator);
}

/**
 * Entropy of a generated password, in bits.
 *
 * This is the honest figure for a *randomly generated* secret: the attacker's
 * work is `log2(poolSize^length)` because there is no pattern to exploit.
 * That is why it is computed here rather than reusing the estimator in
 * `password-strength.js`, which deliberately discounts human patterns that
 * this generator never produces.
 *
 * @param {object} [options]
 * @returns {number}
 */
export function passwordEntropyBits(options = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const pools = poolsFor(config);
  if (pools.length === 0) {
    return 0;
  }
  return Math.round(config.length * Math.log2(pools.join('').length));
}

/**
 * Entropy of a generated passphrase, in bits.
 *
 * @param {{words?: number, includeNumber?: boolean}} [options]
 * @returns {number}
 */
export function passphraseEntropyBits({ words = 4, includeNumber = false } = {}) {
  let bits = words * Math.log2(WORDS.length);
  if (includeNumber) {
    bits += Math.log2(10 * words);
  }
  return Math.round(bits);
}

/** @returns {number} the wordlist size, so the UI can be honest about it */
export function wordlistSize() {
  return WORDS.length;
}
