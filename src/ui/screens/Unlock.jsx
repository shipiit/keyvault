import { useState } from 'preact/hooks';
import { Button } from '../components/Button.jsx';
import { PasswordField } from '../components/Field.jsx';
import { unlockVault } from '../lib/messaging.js';

/**
 * Unlock screen.
 *
 * Deriving the key runs 600,000 PBKDF2 iterations, which takes long enough to
 * notice. The button enters a loading state rather than appearing frozen, and
 * the copy says what is happening — an unexplained pause on a security prompt
 * reads as a failure.
 */
export function Unlock({ onUnlocked }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    if (password === '' || busy) return;

    setBusy(true);
    setError(null);
    try {
      await unlockVault(password);
      onUnlocked();
    } catch (caught) {
      // The background distinguishes a wrong password from a damaged vault.
      // Conflating them would leave a user retyping a correct password
      // forever against a vault that needs restoring instead.
      setError(
        caught.name === 'InvalidPasswordError'
          ? 'Incorrect master password'
          : caught.name === 'UnsupportedBrowserError'
            ? 'This browser cannot protect the vault key. KeyVault needs Chromium 116 or newer.'
            : caught.message,
      );
      setPassword('');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5 p-5">
      <header className="flex flex-col items-center gap-3 pt-4 text-center">
        <LockMark />
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold tracking-tight">Vault locked</h1>
          <p className="text-sm text-[var(--color-fg-muted)]">
            Enter your master password to continue.
          </p>
        </div>
      </header>

      <PasswordField
        label="Master password"
        value={password}
        autoComplete="current-password"
        autoFocus
        error={error}
        onInput={(e) => setPassword(e.currentTarget.value)}
      />

      <Button type="submit" variant="primary" size="lg" disabled={password === ''} loading={busy}>
        {busy ? 'Unlocking…' : 'Unlock'}
      </Button>
    </form>
  );
}

function LockMark() {
  return (
    <div
      className="grid size-12 place-items-center rounded-full bg-[var(--color-accent)]/10"
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-6"
        focusable="false"
      >
        <rect x="4" y="10" width="16" height="10" rx="2.5" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </svg>
    </div>
  );
}
