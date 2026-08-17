import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests, against a real Chromium with the extension loaded.
 *
 * These exist because of what the 697 unit tests structurally cannot see.
 * Every bug found in daily use so far lived in the gap between correct
 * modules and a working extension: asset paths that resolved under Vite but
 * not under `file://`, a content script bundled as an ES module where Chrome
 * requires a classic script, a service worker that had restarted and so held
 * a key in a different form. Each of those passed every unit test.
 *
 * Deliberately not parallel. The tests share one browser profile with one
 * installed extension and one vault, and a second worker unlocking the same
 * vault mid-test would produce failures that have nothing to do with the code.
 */
export default defineConfig({
  testDir: './tests/e2e',
  // A real browser and a real PBKDF2 at 600,000 iterations are both slow.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: process.env.CI === 'true',
  retries: 0,
  reporter: process.env.CI === 'true' ? [['github'], ['list']] : [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
