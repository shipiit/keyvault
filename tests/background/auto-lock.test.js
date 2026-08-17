import { describe, it, expect, beforeEach } from 'vitest';
import { createFakeChrome } from '../helpers/fake-chrome.js';
import { createVaultService } from '../../src/background/vault-service.js';
import { createAutoLock, AUTO_LOCK_ALARM } from '../../src/background/auto-lock.js';

const FAST = { iterations: 1000 };
const MASTER = 'correct-horse-battery-staple';

describe('createAutoLock', () => {
  let chrome;
  let vault;
  let autoLock;

  beforeEach(async () => {
    chrome = createFakeChrome();
    vault = createVaultService({ chrome, kdfOverrides: FAST });
    autoLock = createAutoLock({ chrome, vault });
    await vault.create(MASTER);
  });

  it('schedules an alarm rather than a timer', async () => {
    // setTimeout would be discarded when the service worker is terminated,
    // so the vault would never actually lock.
    await autoLock.schedule(15);
    expect(await chrome.alarms.get(AUTO_LOCK_ALARM)).toEqual({ delayInMinutes: 15 });
  });

  it('replaces an existing alarm rather than stacking them', async () => {
    await autoLock.schedule(15);
    await autoLock.schedule(5);
    expect(chrome.alarms.alarms.size).toBe(1);
    expect(await chrome.alarms.get(AUTO_LOCK_ALARM)).toEqual({ delayInMinutes: 5 });
  });

  it('treats a non-positive interval as auto-lock disabled', async () => {
    await autoLock.schedule(0);
    expect(await autoLock.isScheduled()).toBe(false);
    await autoLock.schedule(-5);
    expect(await autoLock.isScheduled()).toBe(false);
  });

  it('locks the vault when the alarm fires', async () => {
    autoLock.register();
    await autoLock.schedule(15);
    expect((await vault.getStatus()).locked).toBe(false);

    await chrome.alarms.fire(AUTO_LOCK_ALARM);
    expect((await vault.getStatus()).locked).toBe(true);
  });

  it('ignores an unrelated alarm', async () => {
    autoLock.register();
    await chrome.alarms.fire('some.other.alarm');
    expect((await vault.getStatus()).locked).toBe(false);
  });

  it('restarts the countdown on user activity', async () => {
    await autoLock.touch();
    expect(await chrome.alarms.get(AUTO_LOCK_ALARM)).toEqual({ delayInMinutes: 15 });
  });

  it('uses the interval from vault settings', async () => {
    await vault.mutate((data) => ({
      ...data,
      settings: { ...data.settings, autoLockMinutes: 3 },
    }));
    await autoLock.touch();
    expect(await chrome.alarms.get(AUTO_LOCK_ALARM)).toEqual({ delayInMinutes: 3 });
  });

  it('does not schedule anything while the vault is locked', async () => {
    await vault.lock();
    await autoLock.touch();
    expect(await autoLock.isScheduled()).toBe(false);
  });

  it('cancels on demand', async () => {
    await autoLock.schedule(15);
    await autoLock.cancel();
    expect(await autoLock.isScheduled()).toBe(false);
  });

  it('clears a stale alarm on browser startup', async () => {
    autoLock.register();
    await autoLock.schedule(15);
    await chrome.runtime.onStartup.emit();
    expect(await autoLock.isScheduled()).toBe(false);
  });
});
