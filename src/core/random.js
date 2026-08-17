/**
 * Cryptographically secure random bytes.
 *
 * @param {number} length
 * @returns {Uint8Array}
 */
export function randomBytes(length) {
  if (!Number.isInteger(length) || length < 0) {
    throw new RangeError('length must be a non-negative integer');
  }
  const out = new Uint8Array(length);
  if (length > 0) {
    crypto.getRandomValues(out);
  }
  return out;
}

/**
 * Uniform random integer in [0, max) using rejection sampling.
 *
 * Modulo reduction of raw random values is biased whenever `max` is not a
 * power of two: the low residues occur slightly more often than the high
 * ones. For a password generator that bias is a real reduction in entropy,
 * so out-of-range draws are discarded until the remaining range divides
 * evenly instead.
 *
 * @param {number} max exclusive upper bound, >= 1
 * @returns {number}
 */
export function randomInt(max) {
  if (!Number.isInteger(max) || max < 1) {
    throw new RangeError('max must be an integer >= 1');
  }
  if (max === 1) {
    return 0;
  }
  // Largest multiple of `max` representable in 32 bits. Draws at or above
  // this threshold are rejected.
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  let value;
  do {
    crypto.getRandomValues(buf);
    value = buf[0];
  } while (value >= limit);
  return value % max;
}

/**
 * @returns {string} RFC 4122 v4 UUID
 */
export function randomId() {
  return crypto.randomUUID();
}

/**
 * Uniformly select one element.
 *
 * @template T
 * @param {ArrayLike<T>} items
 * @returns {T}
 */
export function pickRandom(items) {
  if (items.length === 0) {
    throw new RangeError('cannot pick from an empty collection');
  }
  return items[randomInt(items.length)];
}
