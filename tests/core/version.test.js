import { describe, it, expect } from 'vitest';
import {
  parseVersion,
  compareVersions,
  isNewerVersion,
  VersionError,
} from '../../src/core/version.js';

describe('parseVersion', () => {
  it('reads a plain version', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] });
  });

  it('accepts the leading v that release tags carry', () => {
    expect(parseVersion('v0.1.0').minor).toBe(1);
  });

  it('keeps a pre-release suffix', () => {
    expect(parseVersion('1.0.0-beta.2').prerelease).toEqual(['beta', '2']);
  });

  it('discards build metadata, which has no bearing on precedence', () => {
    expect(parseVersion('1.0.0+20260817').prerelease).toEqual([]);
  });

  it('refuses what it cannot understand, rather than guessing', () => {
    // Guessing either way is worse than admitting ignorance: guess low and
    // the user sits on a stale build believing it is current; guess high and
    // they are nagged forever by an update that does not exist.
    for (const bad of ['', 'latest', '1.2', '1.2.3.4', 'one.two.three', null, undefined, 12]) {
      expect(() => parseVersion(bad), String(bad)).toThrow(VersionError);
    }
  });
});

describe('compareVersions', () => {
  it('orders by major, then minor, then patch', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.2.0', '1.1.9')).toBeGreaterThan(0);
    expect(compareVersions('1.1.2', '1.1.1')).toBeGreaterThan(0);
    expect(compareVersions('1.1.1', '1.1.1')).toBe(0);
  });

  it('does not compare version parts as text', () => {
    // The classic bug: "10" sorts before "9" as a string, so 0.10.0 would
    // look older than 0.9.0 and the update would never be offered.
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '0.100.0')).toBeGreaterThan(0);
  });

  it('ranks a pre-release below the release it leads to', () => {
    // Backwards, this offers every stable user an "update" to a beta.
    expect(compareVersions('1.2.0-beta.1', '1.2.0')).toBeLessThan(0);
    expect(compareVersions('1.2.0', '1.2.0-rc.1')).toBeGreaterThan(0);
  });

  it('orders pre-releases among themselves', () => {
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0);
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.10')).toBeLessThan(0);
    expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBeLessThan(0);
  });

  it('ranks numeric identifiers below alphanumeric ones, as semver requires', () => {
    expect(compareVersions('1.0.0-1', '1.0.0-alpha')).toBeLessThan(0);
  });
});

describe('isNewerVersion', () => {
  it('is true only for a genuinely newer release', () => {
    expect(isNewerVersion('0.2.0', '0.1.0')).toBe(true);
    expect(isNewerVersion('0.1.0', '0.1.0')).toBe(false);
    expect(isNewerVersion('0.0.9', '0.1.0')).toBe(false);
  });

  it('handles the tag form GitHub actually publishes', () => {
    expect(isNewerVersion('v0.2.0', '0.1.0')).toBe(true);
  });
});
