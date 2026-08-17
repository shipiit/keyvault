/**
 * Version comparison, for deciding whether a release is newer than what is
 * installed.
 *
 * Deliberately strict about what it accepts. A comparison that silently
 * treats an unparseable version as "older" would leave someone on a stale
 * build believing they were current, and a comparison that treats it as
 * "newer" would nag forever. Both are worse than saying "I cannot tell".
 */

/** Raised when a version string cannot be understood. */
export class VersionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VersionError';
  }
}

/**
 * Parse a version.
 *
 * Accepts a leading `v` because that is how releases are conventionally
 * tagged, and a pre-release suffix because a tag may carry one. Build
 * metadata is discarded: semver says it takes no part in precedence.
 *
 * @param {string} input
 * @returns {{major: number, minor: number, patch: number, prerelease: string[]}}
 */
export function parseVersion(input) {
  if (typeof input !== 'string') {
    throw new VersionError('version must be a string');
  }
  const trimmed = input.trim().replace(/^v/i, '');
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(trimmed);
  if (match === null) {
    throw new VersionError(`not a version: ${input}`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  };
}

/**
 * Compare two versions.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} negative if a < b, 0 if equal, positive if a > b
 */
export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);

  for (const part of ['major', 'minor', 'patch']) {
    if (left[part] !== right[part]) {
      return left[part] - right[part];
    }
  }

  // A version with a pre-release suffix precedes the release it leads to:
  // 1.2.0-beta.1 is older than 1.2.0. Getting this backwards would offer
  // everyone an "update" from a stable build to a beta.
  if (left.prerelease.length === 0 && right.prerelease.length > 0) {
    return 1;
  }
  if (left.prerelease.length > 0 && right.prerelease.length === 0) {
    return -1;
  }

  for (
    let index = 0;
    index < Math.max(left.prerelease.length, right.prerelease.length);
    index += 1
  ) {
    const l = left.prerelease[index];
    const r = right.prerelease[index];
    if (l === undefined) return -1;
    if (r === undefined) return 1;

    const lNumeric = /^\d+$/.test(l);
    const rNumeric = /^\d+$/.test(r);
    if (lNumeric && rNumeric) {
      if (Number(l) !== Number(r)) return Number(l) - Number(r);
    } else if (lNumeric !== rNumeric) {
      // Numeric identifiers rank below alphanumeric ones.
      return lNumeric ? -1 : 1;
    } else if (l !== r) {
      return l < r ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Is `candidate` newer than `installed`?
 *
 * @param {string} candidate
 * @param {string} installed
 * @returns {boolean}
 */
export function isNewerVersion(candidate, installed) {
  return compareVersions(candidate, installed) > 0;
}
