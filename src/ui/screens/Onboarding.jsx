import { useState } from 'preact/hooks';
import { Button } from '../components/Button.jsx';
import { PasswordField } from '../components/Field.jsx';
import { createVault } from '../lib/messaging.js';
import { assessPassword, timeToCrack } from '../../core/password-strength.js';

const MIN_LENGTH = 12;

const METER_COLORS = [
  'bg-[var(--color-danger)]',
  'bg-[var(--color-danger)]',
  'bg-[var(--color-warn)]',
  'bg-[var(--color-success)]',
  'bg-[var(--color-success)]',
];

export function Onboarding({ onCreated }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // The shared offline estimator, not a second ad-hoc one: two disagreeing
  // strength meters in the same product is worse than none.
  const strength = password === '' ? null : assessPassword(password);
  const tooShort = password !== '' && password.length < MIN_LENGTH;
  const mismatch = confirm !== '' && confirm !== password;
  const canSubmit = password.length >= MIN_LENGTH && confirm === password && acknowledged && !busy;

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canSubmit) return;

    setBusy(true);
    setError(null);
    try {
      await createVault(password);
      onCreated();
    } catch (caught) {
      setError(caught.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5 p-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Create your vault</h1>
        <p className="text-sm text-[var(--color-fg-muted)]">
          One password protects everything. Choose something long that you will not forget.
        </p>
      </header>

      <div className="flex flex-col gap-4">
        <div>
          <PasswordField
            label="Master password"
            value={password}
            masterPassword
            autoFocus
            onInput={(e) => setPassword(e.currentTarget.value)}
          />
          {strength !== null && (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex h-1 flex-1 gap-1" aria-hidden="true">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className={[
                      'h-full flex-1 rounded-full transition-colors duration-[var(--dur-200)]',
                      i < strength.score && !tooShort
                        ? METER_COLORS[strength.score]
                        : 'bg-[var(--color-border)]',
                    ].join(' ')}
                  />
                ))}
              </div>
              <span className="text-xs font-medium text-[var(--color-fg-muted)]" aria-live="polite">
                {tooShort ? `At least ${MIN_LENGTH} characters` : strength.label}
              </span>
            </div>
          )}
          {strength !== null && !tooShort && (
            <p className="mt-1.5 text-xs text-[var(--color-fg-subtle)]">
              {strength.warning ?? `Would take ${timeToCrack(strength.entropyBits)} to crack.`}
            </p>
          )}
        </div>

        <PasswordField
          label="Confirm master password"
          value={confirm}
          masterPassword
          error={mismatch ? 'Passwords do not match' : null}
          onInput={(e) => setConfirm(e.currentTarget.value)}
        />
      </div>

      {/* The single most important thing a new user must understand. It is a
          checkbox rather than a paragraph because local-only storage means
          a forgotten password is genuinely unrecoverable. */}
      <label className="flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-card)] border border-[var(--color-warn)]/40 bg-[var(--color-warn)]/5 p-3">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.currentTarget.checked)}
          className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
        />
        <span className="text-xs leading-relaxed text-[var(--color-fg)]">
          I understand that my vault is stored only on this device and that{' '}
          <strong className="font-semibold">
            there is no way to recover it if I forget this password
          </strong>
          . No reset link, no support account.
        </span>
      </label>

      {error !== null && (
        <p role="alert" className="text-sm font-medium text-[var(--color-danger)]">
          {error}
        </p>
      )}

      <Button type="submit" variant="primary" size="lg" disabled={!canSubmit} loading={busy}>
        {busy ? 'Encrypting…' : 'Create vault'}
      </Button>
    </form>
  );
}
