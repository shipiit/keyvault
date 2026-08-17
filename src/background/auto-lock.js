/** Alarm name for the idle auto-lock timer. */
export const AUTO_LOCK_ALARM = 'keyvault.autoLock';

/**
 * Idle auto-lock.
 *
 * Backed by `chrome.alarms` rather than `setTimeout`. A Manifest V3 service
 * worker is terminated after roughly 30 seconds idle, taking every pending
 * timer with it — a `setTimeout`-based lock would simply never fire, leaving
 * the vault unlocked indefinitely. Alarms are owned by the browser and
 * survive worker termination, which is exactly the property needed here.
 *
 * @param {object} options
 * @param {object} options.chrome extension API namespace
 * @param {object} options.vault vault service
 */
export function createAutoLock({ chrome, vault }) {
  return {
    /**
     * (Re)start the idle timer. Called on unlock and on each user action, so
     * the vault locks after genuine inactivity rather than a fixed interval
     * from unlock.
     *
     * @param {number} minutes 0 or less disables auto-lock
     */
    async schedule(minutes) {
      await chrome.alarms.clear(AUTO_LOCK_ALARM);
      if (!Number.isFinite(minutes) || minutes <= 0) {
        return;
      }
      await chrome.alarms.create(AUTO_LOCK_ALARM, { delayInMinutes: minutes });
    },

    async cancel() {
      await chrome.alarms.clear(AUTO_LOCK_ALARM);
    },

    /**
     * @returns {Promise<boolean>} whether an auto-lock is currently pending
     */
    async isScheduled() {
      return (await chrome.alarms.get(AUTO_LOCK_ALARM)) !== null;
    },

    /**
     * Reset the countdown following user activity, if the vault is unlocked.
     */
    async touch() {
      const { locked } = await vault.getStatus();
      if (locked) {
        return;
      }
      const { settings } = await vault.getData();
      await this.schedule(settings.autoLockMinutes);
    },

    /**
     * Wire up the alarm and browser-lifecycle listeners.
     *
     * Registered at worker startup — including on every wake — because
     * listeners do not survive termination either.
     */
    register() {
      chrome.alarms.onAlarm.addListener(async (alarm) => {
        if (alarm.name === AUTO_LOCK_ALARM) {
          await vault.lock();
        }
      });

      // The session key is memory-only, so a browser restart already drops it.
      // Clearing the stale alarm keeps state tidy rather than leaving a timer
      // pending against a vault that is already locked.
      chrome.runtime.onStartup.addListener(async () => {
        await chrome.alarms.clear(AUTO_LOCK_ALARM);
      });
    },
  };
}
