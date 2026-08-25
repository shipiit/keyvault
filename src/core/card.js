/**
 * Payment cards.
 *
 * The card number carries more than it looks: the first digits name the
 * issuer, and the whole thing has a checksum. Both are computed here, both
 * offline, because a mistyped card number that fails silently is discovered
 * at a checkout rather than in the vault.
 *
 * Nothing validates a card against an issuer — that would mean sending
 * somebody's card number somewhere, which is the one thing a vault must not
 * do with it.
 */

/**
 * Issuer ranges, by the prefixes the card industry publishes.
 *
 * Ordered longest-first so `2221`-`2720` (Mastercard's newer range) is not
 * swallowed by a shorter rule.
 */
const BRANDS = Object.freeze([
  { brand: 'American Express', test: (n) => /^3[47]/.test(n), lengths: [15], cvv: 4 },
  { brand: 'Diners Club', test: (n) => /^3(?:0[0-5]|[68])/.test(n), lengths: [14, 16], cvv: 3 },
  { brand: 'JCB', test: (n) => /^35(?:2[89]|[3-8][0-9])/.test(n), lengths: [16], cvv: 3 },
  {
    brand: 'Mastercard',
    test: (n) => /^5[1-5]/.test(n) || inRange(n, 2221, 2720, 4),
    lengths: [16],
    cvv: 3,
  },
  { brand: 'Discover', test: (n) => /^6(?:011|5|4[4-9])/.test(n), lengths: [16, 19], cvv: 3 },
  { brand: 'UnionPay', test: (n) => /^62/.test(n), lengths: [16, 17, 18, 19], cvv: 3 },
  {
    brand: 'Maestro',
    test: (n) => /^(?:5018|5020|5038|6304|6759|676[1-3])/.test(n),
    lengths: [12, 13, 14, 15, 16, 17, 18, 19],
    cvv: 3,
  },
  { brand: 'Visa', test: (n) => /^4/.test(n), lengths: [13, 16, 19], cvv: 3 },
]);

/** @param {string} digits */
function inRange(digits, low, high, width) {
  if (digits.length < width) {
    return false;
  }
  const prefix = Number(digits.slice(0, width));
  return prefix >= low && prefix <= high;
}

/**
 * Strip everything that is not a digit.
 *
 * People type card numbers in groups, from a physical card, and every one of
 * `4111 1111 1111 1111`, `4111-1111-1111-1111` and `4111111111111111` is the
 * same card.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function digitsOf(value) {
  return typeof value === 'string' ? value.replace(/\D/g, '') : '';
}

/**
 * Name the issuer from the card number's prefix.
 *
 * @param {string} number
 * @returns {{brand: string, lengths: number[], cvv: number}|null}
 */
export function detectBrand(number) {
  const digits = digitsOf(number);
  if (digits === '') {
    return null;
  }
  const found = BRANDS.find((candidate) => candidate.test(digits));
  return found === undefined
    ? null
    : { brand: found.brand, lengths: found.lengths, cvv: found.cvv };
}

/**
 * The Luhn checksum, which every payment card satisfies.
 *
 * Catches a transposed or mistyped digit — the failure that is otherwise
 * discovered at a checkout, months later, with no way to tell whether the
 * card changed or the typing did.
 *
 * @param {string} number
 * @returns {boolean}
 */
export function passesLuhn(number) {
  const digits = digitsOf(number);
  if (digits.length < 12) {
    return false;
  }
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let value = digits.charCodeAt(i) - 48;
    if (double) {
      value *= 2;
      if (value > 9) {
        value -= 9;
      }
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Group a card number the way it is printed on the card.
 *
 * @param {string} number
 * @returns {string}
 */
export function formatNumber(number) {
  const digits = digitsOf(number);
  // Amex is printed 4-6-5, not in fours, and regrouping it makes it harder to
  // check against the card in your hand.
  if (/^3[47]/.test(digits)) {
    return [digits.slice(0, 4), digits.slice(4, 10), digits.slice(10, 15)]
      .filter(Boolean)
      .join(' ');
  }
  return digits.replace(/(.{4})/g, '$1 ').trim();
}

/**
 * Show the last four, as a statement or a checkout does.
 *
 * @param {string} number
 * @returns {string}
 */
export function maskNumber(number) {
  const digits = digitsOf(number);
  if (digits.length < 4) {
    return '••••';
  }
  return `•••• ${digits.slice(-4)}`;
}

/**
 * Has the card expired, given `MM` and `YYYY`?
 *
 * A card is valid through the *end* of its expiry month, which is a
 * fencepost worth getting right: treating the first of the month as expired
 * would call a perfectly good card dead for up to thirty days.
 *
 * @param {string|number} month
 * @param {string|number} year
 * @param {number} [now]
 * @returns {boolean|null} null when not enough is known
 */
export function isExpired(month, year, now = Date.now()) {
  const m = Number(month);
  const y = Number(year);
  if (!Number.isInteger(m) || !Number.isInteger(y) || m < 1 || m > 12 || y < 1000) {
    return null;
  }
  // The first instant of the following month.
  const expiresAfter = new Date(y, m, 1, 0, 0, 0).getTime();
  return now >= expiresAfter;
}

/**
 * Everything worth saying about a stored card.
 *
 * @param {object} card
 * @param {number} [now]
 */
export function describeCard(card, now = Date.now()) {
  const number = card?.number ?? '';
  const detected = detectBrand(number);
  const digits = digitsOf(number);

  return {
    brand: detected?.brand ?? null,
    masked: maskNumber(number),
    // Only complain once there is enough of a number to judge. Warning while
    // somebody is still typing is noise they learn to ignore.
    valid: digits.length === 0 ? null : passesLuhn(number),
    lengthLooksWrong:
      detected === null || digits.length === 0 ? null : !detected.lengths.includes(digits.length),
    expired: isExpired(card?.expiryMonth, card?.expiryYear, now),
    cvvLength: detected?.cvv ?? 3,
  };
}
