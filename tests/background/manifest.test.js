import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../src');
const manifest = JSON.parse(readFileSync(resolve(srcDir, 'manifest.json'), 'utf8'));

describe('manifest.json', () => {
  it('is Manifest V3', () => {
    // MV2 is no longer accepted by the Chrome Web Store.
    expect(manifest.manifest_version).toBe(3);
  });

  it('points at a service worker that exists, as an ES module', () => {
    expect(manifest.background.type).toBe('module');
    expect(existsSync(resolve(srcDir, manifest.background.service_worker))).toBe(true);
  });

  it('requires a Chrome new enough for storage.session.setAccessLevel', () => {
    // setAccessLevel landed in Chrome 102, but TRUSTED_CONTEXTS behaviour was
    // only reliable from 116. Below that the key restriction cannot be relied
    // on, so the extension should refuse to install rather than run insecurely.
    expect(Number(manifest.minimum_chrome_version)).toBeGreaterThanOrEqual(116);
  });

  it('requests no host permissions at install time', () => {
    // Autofill uses activeTab plus explicit user action instead of blanket
    // host access. A password manager asking for <all_urls> up front is
    // asking for far more trust than it needs at this stage.
    expect(manifest.host_permissions).toEqual([]);
  });

  it('keeps the breach-check host optional, so a default install has no network reach', () => {
    // Breach checking is the only feature that talks to a network at all.
    // Listing its host as optional means Chrome grants it only when the user
    // turns the feature on, and the permission can be revoked afterwards.
    expect(manifest.optional_host_permissions).toEqual(['https://api.pwnedpasswords.com/*']);
    expect(manifest.host_permissions).not.toContain('https://api.pwnedpasswords.com/*');
  });

  it('requests only the permissions it uses', () => {
    expect(new Set(manifest.permissions)).toEqual(new Set(['storage', 'alarms', 'activeTab']));
  });

  it('does not request the broad tabs permission', () => {
    // "tabs" produces an install-time warning about reading browsing history.
    // The popup only needs the URL of the tab it was opened over, and opening
    // it from the toolbar is itself the user gesture that activates
    // activeTab for that tab — so the broad permission buys nothing.
    expect(manifest.permissions).not.toContain('tabs');
  });

  it('forbids remote and inline script via CSP', () => {
    const csp = manifest.content_security_policy.extension_pages;
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('https://');
  });

  it('declares the autofill content script on web pages only', () => {
    const [script] = manifest.content_scripts;
    expect(script.matches).toEqual(['http://*/*', 'https://*/*']);
    expect(existsSync(resolve(srcDir, script.js[0]))).toBe(true);
  });

  it('does not inject into about:blank', () => {
    // about:blank inherits its opener's origin, so a page can create one and
    // use it to solicit a fill under an origin it should not have.
    expect(manifest.content_scripts[0].match_about_blank).toBe(false);
  });

  it('runs the content script at document_idle', () => {
    // document_start would race the page's own scripts for the DOM it needs
    // to inspect, and buys nothing: nobody logs in before the page renders.
    expect(manifest.content_scripts[0].run_at).toBe('document_idle');
  });

  it('matches the package version', () => {
    const pkg = JSON.parse(readFileSync(resolve(srcDir, '../package.json'), 'utf8'));
    expect(manifest.version).toBe(pkg.version);
  });
});
