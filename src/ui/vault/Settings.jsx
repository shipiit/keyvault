import { useEffect, useState } from 'preact/hooks';
import { BackupSection } from './BackupSection.jsx';
import { DeviceUnlockSection } from './DeviceUnlock.jsx';
import { send } from '../lib/messaging.js';
import { MIN_LENGTH as GENERATOR_MIN, MAX_LENGTH as GENERATOR_MAX } from '../../core/generator.js';

const LOCK_INTERVALS = [
  { value: 1, label: '1 minute' },
  { value: 5, label: '5 minutes' },
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 0, label: 'Never' },
];

/**
 * Settings.
 *
 * Every control here changes something that already existed but had no way
 * to reach it — the breach check in particular was telling users it was
 * "switched off in settings" while there were no settings to switch it on
 * in.
 */
export function Settings({ onChanged }) {
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    send('settings/get')
      .then(({ settings: loaded }) => setSettings(loaded))
      .catch((caught) => setError(caught.message));
  }, []);

  async function update(changes) {
    // Applied locally first so a toggle responds immediately rather than
    // after a round-trip and a vault re-encryption.
    setSettings((current) => ({
      ...current,
      ...changes,
      generator: { ...current.generator, ...(changes.generator ?? {}) },
    }));
    try {
      const { settings: saved } = await send('settings/update', { changes });
      setSettings(saved);
      onChanged?.();
    } catch (caught) {
      setError(caught.message);
    }
  }

  if (error !== null) {
    return (
      <Pane>
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {error}
        </p>
      </Pane>
    );
  }
  if (settings === null) {
    return (
      <Pane>
        <div className="h-24 animate-pulse rounded-[var(--radius-card)] bg-[var(--color-surface-hover)]" />
      </Pane>
    );
  }

  return (
    <Pane>
      <Section title="Security" description="How KeyVault protects the vault on this device.">
        <Row
          label="Lock after inactivity"
          hint={
            settings.autoLockMinutes === 0
              ? 'The vault stays unlocked until you lock it or close the browser.'
              : 'The vault locks itself and needs your master password again.'
          }
        >
          <select
            value={String(settings.autoLockMinutes)}
            onChange={(event) => update({ autoLockMinutes: Number(event.currentTarget.value) })}
            aria-label="Lock after inactivity"
            className={selectClass}
          >
            {LOCK_INTERVALS.map((option) => (
              <option key={option.value} value={String(option.value)}>
                {option.label}
              </option>
            ))}
          </select>
        </Row>

        <Row
          label="Lock when the browser closes"
          hint="The unlocked key is held in memory only, so this is always true. Shown for clarity."
        >
          <Toggle checked disabled label="Lock when the browser closes" onChange={() => {}} />
        </Row>

        <Row
          label="Fill logins automatically"
          hint={
            'Fills a saved login as the page loads, when exactly one matches. Submitting stays ' +
            'a separate, per-item choice.'
          }
        >
          <Toggle
            checked={settings.autofillOnLoad !== false}
            label="Fill logins automatically"
            onChange={(next) => update({ autofillOnLoad: next })}
          />
        </Row>

        <Row
          label="Clear the clipboard after"
          hint="Anything you copy is wiped after this long, so a password does not sit there."
        >
          <select
            value={String(settings.clipboardClearSeconds)}
            onChange={(event) =>
              update({ clipboardClearSeconds: Number(event.currentTarget.value) })
            }
            aria-label="Clear the clipboard after"
            className={selectClass}
          >
            {[15, 30, 60, 120].map((seconds) => (
              <option key={seconds} value={String(seconds)}>
                {seconds} seconds
              </option>
            ))}
          </select>
        </Row>
      </Section>

      <DeviceUnlockSection />

      <Section
        title="Breach checking"
        description="The only feature in KeyVault that uses the network. Off by default."
      >
        <Row
          label="Check passwords against public breach data"
          hint={
            'Only the first five characters of a password’s hash are sent, so the service ' +
            'cannot tell which password was checked. Nothing else leaves this device.'
          }
        >
          <Toggle
            checked={settings.breachCheckEnabled === true}
            label="Check passwords against public breach data"
            onChange={(next) => update({ breachCheckEnabled: next })}
          />
        </Row>
      </Section>

      <Section
        title="Password generator"
        description="The defaults used when you generate a new password."
      >
        <Row label="Length">
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={GENERATOR_MIN}
              max={GENERATOR_MAX}
              value={settings.generator.length}
              aria-label="Default password length"
              onInput={(event) =>
                update({ generator: { length: Number(event.currentTarget.value) } })
              }
              className="h-1.5 w-40 cursor-pointer appearance-none rounded-full bg-[var(--color-border-strong)] accent-[var(--color-accent)]"
            />
            <span className="tabular w-8 text-right text-sm font-semibold">
              {settings.generator.length}
            </span>
          </div>
        </Row>

        {[
          ['uppercase', 'Include uppercase letters'],
          ['lowercase', 'Include lowercase letters'],
          ['digits', 'Include numbers'],
          ['symbols', 'Include symbols'],
          ['avoidAmbiguous', 'Avoid look-alike characters'],
        ].map(([key, label]) => (
          <Row key={key} label={label}>
            <Toggle
              checked={settings.generator[key] === true}
              label={label}
              onChange={(next) => update({ generator: { [key]: next } })}
            />
          </Row>
        ))}
      </Section>

      <BackupSection onChanged={onChanged} />

      <Section title="About" description="">
        <p className="text-xs leading-relaxed text-[var(--color-fg-muted)]">
          KeyVault stores your vault on this device only. There is no account and no server, which
          means nobody else can read your passwords — and also that{' '}
          <strong className="font-semibold text-[var(--color-fg)]">
            a forgotten master password cannot be recovered
          </strong>
          . Keep a backup.
        </p>
        <p className="mt-2 text-xs text-[var(--color-fg-subtle)]">
          Not yet audited. Treat it as something to try rather than to trust with credentials you
          cannot afford to lose.
        </p>
      </Section>
    </Pane>
  );
}

const selectClass = [
  'h-9 rounded-[var(--radius-field)] border border-[var(--color-border-strong)] px-2 text-sm',
  'bg-[var(--color-surface)] text-[var(--color-fg)]',
  'transition-colors duration-[var(--dur-150)] hover:border-[var(--color-fg-subtle)]',
].join(' ');

function Pane({ children }) {
  return (
    <section
      aria-label="Settings"
      className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-[var(--color-panel)] px-8 py-6"
    >
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Settings</h1>
      <div className="flex max-w-2xl flex-col gap-6">{children}</div>
    </section>
  );
}

function Section({ title, description, children }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      {description !== '' && (
        <p className="mt-0.5 text-xs text-[var(--color-fg-muted)]">{description}</p>
      )}
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm">{label}</span>
        {hint !== undefined && (
          <span className="text-xs leading-relaxed text-[var(--color-fg-muted)]">{hint}</span>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        'relative h-6 w-11 shrink-0 rounded-full transition-colors duration-[var(--dur-150)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border-strong)]',
      ].join(' ')}
    >
      <span
        className={[
          'absolute top-0.5 size-5 rounded-full bg-white shadow',
          'transition-[left] duration-[var(--dur-150)] ease-[var(--ease-out-quint)]',
          checked ? 'left-[22px]' : 'left-0.5',
        ].join(' ')}
      />
    </button>
  );
}
