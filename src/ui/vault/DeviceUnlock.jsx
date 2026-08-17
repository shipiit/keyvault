import { useEffect, useState } from 'preact/hooks';
import { Button } from '../components/Button.jsx';
import { send } from '../lib/messaging.js';
import { checkDeviceUnlockSupport, registerDeviceUnlock, evaluatePrf } from '../lib/webauthn.js';

/**
 * Turning Touch ID / Windows Hello on and off.
 *
 * The copy here matters as much as the code. This feature trades a real
 * security property — that only someone who knows the master password can
 * open the vault — for convenience, and the user has to be told what they
 * are trading before they trade it.
 */
export function DeviceUnlockSection() {
  const [support, setSupport] = useState(null);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    checkDeviceUnlockSupport().then(setSupport);
    send('device/status')
      .then(setStatus)
      .catch(() => setStatus({ enabled: false }));
  }, []);

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      const { credentialId, prfOutput } = await registerDeviceUnlock({
        accountName: 'KeyVault on this device',
      });
      // The PRF output is bytes; extension messaging serialises as JSON, so
      // it crosses as a plain array and is rebuilt on the other side.
      await send('device/enable', { credentialId, prfOutput: Array.from(prfOutput) });
      setStatus({ enabled: true, credentialId });
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    try {
      await send('device/disable');
      setStatus({ enabled: false, credentialId: null });
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] p-5">
      <h2 className="text-sm font-semibold">Unlock with this device</h2>
      <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-fg-muted)]">
        Use Touch ID, Windows Hello, or your device password instead of typing your master password
        every time.
      </p>

      {support !== null && !support.available && (
        <p className="mt-3 rounded-[var(--radius-field)] bg-[var(--color-field)] p-3 text-xs leading-relaxed text-[var(--color-fg-muted)]">
          {support.reason}
        </p>
      )}

      {support?.available === true && (
        <>
          <div className="mt-3 rounded-[var(--radius-field)] border border-[var(--color-warn)]/40 bg-[var(--color-warn)]/5 p-3">
            <p className="text-xs font-medium">What this changes</p>
            <ul className="mt-1.5 flex flex-col gap-1 text-xs leading-relaxed text-[var(--color-fg-muted)]">
              <li>
                Anyone who can pass this device&rsquo;s own Touch ID or password check can open your
                vault.
              </li>
              <li>
                A copy of your vault key is stored on this disk, locked to this device&rsquo;s
                secure hardware. It is useless on any other machine.
              </li>
              <li>
                Your master password keeps working and is never replaced — losing this device must
                not lose the vault.
              </li>
            </ul>
          </div>

          {status?.enabled === true ? (
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-[var(--color-success)]">
                Enabled on this device
              </span>
              <Button variant="danger" size="sm" loading={busy} onClick={disable}>
                Turn off
              </Button>
            </div>
          ) : (
            <Button variant="primary" size="sm" className="mt-3" loading={busy} onClick={enable}>
              Turn on device unlock
            </Button>
          )}
        </>
      )}

      {error !== null && (
        <p role="alert" className="mt-2 text-xs leading-relaxed text-[var(--color-danger)]">
          {error}
        </p>
      )}
    </section>
  );
}

/**
 * The "Use Touch ID" button on the lock screen.
 *
 * Renders nothing unless device unlock is actually set up, so the lock
 * screen never offers something that cannot work.
 */
export function DeviceUnlockButton({ onUnlocked }) {
  const [credentialId, setCredentialId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    send('device/status')
      .then(({ enabled, credentialId: id }) => enabled && setCredentialId(id))
      .catch(() => {});
  }, []);

  if (credentialId === null) {
    return null;
  }

  async function unlock() {
    setBusy(true);
    setError(null);
    try {
      const prfOutput = await evaluatePrf(credentialId);
      await send('device/unlock', { prfOutput: Array.from(prfOutput) });
      onUnlocked();
    } catch (caught) {
      // Always recoverable: the master password field is right there.
      setError(caught.message);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button variant="secondary" size="lg" loading={busy} onClick={unlock}>
        Use Touch ID or device password
      </Button>
      {error !== null && (
        <p role="alert" className="text-center text-xs text-[var(--color-warn)]">
          {error}
        </p>
      )}
    </div>
  );
}
