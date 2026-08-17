import { useEffect, useState } from 'preact/hooks';
import { Button } from '../components/Button.jsx';
import { send } from '../lib/messaging.js';
import {
  checkDeviceUnlockSupport,
  registerDeviceUnlock,
  evaluatePrf,
  RP_DOMAINS,
  DEFAULT_RP_DOMAIN,
} from '../lib/webauthn.js';

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
  const [step, setStep] = useState(null);
  const [rpId, setRpId] = useState(DEFAULT_RP_DOMAIN);

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
      // Reported step by step. Setup spans a permission prompt, a Touch ID
      // prompt and a vault write, and when it fails the only useful question
      // is which of them it got to.
      const { credentialId, prfOutput } = await registerDeviceUnlock({
        accountName: 'KeyVault on this device',
        rpId,
        onStep: setStep,
      });

      setStep('Saving to the vault…');
      // The PRF output is bytes; extension messaging serialises as JSON, so
      // it crosses as a plain array and is rebuilt on the other side.
      await send('device/enable', { credentialId, rpId, prfOutput: Array.from(prfOutput) });

      setStep('Confirming…');
      // Read back rather than assumed. Showing "Enabled" from a local flag
      // is how this silently reverted: the UI claimed success while nothing
      // had been stored.
      const confirmed = await send('device/status');
      if (confirmed.enabled !== true) {
        throw new Error('the vault did not record the credential — try again');
      }

      setStatus(confirmed);
      setStep(null);
    } catch (caught) {
      console.error('[keyvault] device unlock setup failed', caught);
      setError(caught.message);
      setStep(null);
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

          {status?.enabled !== true && (
            <label className="mt-3 flex flex-col gap-1">
              <span className="text-xs font-medium">Identifier domain</span>
              <select
                value={rpId}
                onChange={(event) => setRpId(event.currentTarget.value)}
                className="h-9 rounded-[var(--radius-field)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 text-sm"
              >
                {RP_DOMAINS.map((domain) => (
                  <option key={domain} value={domain}>
                    {domain}
                  </option>
                ))}
              </select>
              {/* Stated because the permission prompt that follows looks
                  alarming out of context. */}
              <span className="text-xs leading-relaxed text-[var(--color-fg-subtle)]">
                Chrome will not let an extension use its own address as an identifier, so it needs a
                domain you own. Nothing is ever sent there — it is only a label your Mac keys the
                credential to. Chrome will ask for permission for this domain next.
              </span>
            </label>
          )}

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

      {step !== null && (
        <p className="mt-2 text-xs text-[var(--color-fg-muted)]" aria-live="polite">
          {step}
        </p>
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
 *
 * When it is set up, it prompts by itself as soon as the lock screen
 * appears — the whole point of Touch ID is not having to do anything, and a
 * button you must click first is barely cheaper than typing. The button
 * stays for the second attempt, because the first one can be declined.
 */
export function DeviceUnlockButton({ onUnlocked }) {
  const [credentialId, setCredentialId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [prompted, setPrompted] = useState(false);

  const [rpId, setRpId] = useState(DEFAULT_RP_DOMAIN);

  useEffect(() => {
    send('device/status')
      .then(({ enabled, credentialId: id, rpId: storedRpId }) => {
        if (enabled) {
          setCredentialId(id);
          // The credential only releases key material under the RP ID it was
          // registered with.
          setRpId(storedRpId ?? DEFAULT_RP_DOMAIN);
        }
      })
      .catch(() => {});
  }, []);

  const ready = credentialId !== null;

  useEffect(() => {
    // Exactly once per lock screen. Re-prompting after a decline would put
    // the user in a loop with a system dialog they just dismissed, and
    // there would be no way to reach the password field underneath it.
    if (!ready || prompted) {
      return;
    }
    setPrompted(true);
    unlock({ automatic: true });
  }, [ready, prompted]);

  if (!ready) {
    return null;
  }

  async function unlock(options = {}) {
    setBusy(true);
    setError(null);
    try {
      const prfOutput = await evaluatePrf(credentialId, rpId);
      await send('device/unlock', { prfOutput: Array.from(prfOutput) });
      onUnlocked();
    } catch (caught) {
      // Always recoverable: the master password field is right there.
      //
      // A declined prompt is a choice, not a fault. Reporting "the operation
      // was aborted" to someone who deliberately hit Cancel — most likely to
      // type their password instead — is noise, so the automatic attempt
      // stays silent and simply leaves the button.
      setError(options.automatic === true && isDeclined(caught) ? null : caught.message);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button variant="secondary" size="lg" loading={busy} onClick={() => unlock()}>
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

/**
 * Did the user dismiss the prompt, rather than something going wrong?
 *
 * WebAuthn reports a cancelled prompt and a genuinely unusable authenticator
 * with the same `NotAllowedError`, deliberately, so a site cannot tell the
 * two apart and probe for authenticators. That ambiguity is fine here: both
 * mean "carry on with the password", which is what the lock screen already
 * offers.
 *
 * @param {Error} error
 */
function isDeclined(error) {
  return (
    error?.name === 'NotAllowedError' ||
    /abort|cancel|not allowed|timed out/i.test(error?.message ?? '')
  );
}
