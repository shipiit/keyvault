/**
 * One shared one-second clock for the whole popup.
 *
 * Every visible TOTP code needs to refresh each second. Giving each row its
 * own `setInterval` costs a timer and a background round-trip per row per
 * second, which is wasteful with ten 2FA entries on screen and grows linearly.
 *
 * A single interval, started on the first subscriber and stopped on the last,
 * keeps that flat: one timer regardless of how many codes are displayed, and
 * no timer at all when none are.
 */

const subscribers = new Set();
let timer = null;

function tick() {
  for (const notify of subscribers) {
    notify();
  }
}

/**
 * @param {() => void} notify called once per second
 * @returns {() => void} unsubscribe
 */
export function subscribeToSeconds(notify) {
  subscribers.add(notify);
  if (timer === null) {
    timer = setInterval(tick, 1000);
  }
  return () => {
    subscribers.delete(notify);
    if (subscribers.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Test hook. */
export function activeSubscriberCount() {
  return subscribers.size;
}

/** Test hook. */
export function isTickerRunning() {
  return timer !== null;
}
