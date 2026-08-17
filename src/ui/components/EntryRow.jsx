import { useState } from 'preact/hooks';
import { TotpCode } from './TotpCode.jsx';
import { getEntry, copyWithAutoClear } from '../lib/messaging.js';

/**
 * One credential in the list.
 *
 * The row shows metadata only. The password is fetched on demand, at the
 * moment the user asks to copy it, and is never held in component state — so
 * the popup's memory contains only what the user explicitly asked for.
 */
export function EntryRow({ entry, matchesCurrentSite = false }) {
  const [copied, setCopied] = useState(null);
  const [error, setError] = useState(null);

  async function copyField(field) {
    setError(null);
    try {
      const { entry: full } = await getEntry(entry.id);
      const value = full[field];
      if (!value) {
        setError(`No ${field} saved`);
        return;
      }
      await copyWithAutoClear(value);
      setCopied(field);
      setTimeout(() => setCopied(null), 1600);
    } catch (caught) {
      setError(caught.message);
    }
  }

  return (
    <li
      className={[
        'group flex items-center gap-3 rounded-[var(--radius-card)] px-3 py-2.5',
        'border border-transparent transition-colors duration-[var(--dur-150)]',
        'hover:border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]',
        'focus-within:border-[var(--color-border)] focus-within:bg-[var(--color-surface-hover)]',
      ].join(' ')}
    >
      <Favicon title={entry.title} />

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{entry.title}</span>
          {matchesCurrentSite && (
            <span className="shrink-0 rounded-full bg-[var(--color-accent)]/12 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-accent)]">
              This site
            </span>
          )}
        </div>
        <span className="truncate text-xs text-[var(--color-fg-muted)]">
          {entry.username || 'No username'}
        </span>
        {entry.hasTotp && (
          <div className="mt-1">
            <TotpCode entryId={entry.id} />
          </div>
        )}
        {error !== null && (
          <span role="alert" className="text-xs text-[var(--color-danger)]">
            {error}
          </span>
        )}
      </div>

      {/* Revealed on hover or keyboard focus. Hiding them entirely behind
          hover would make the row unusable by keyboard, so focus-within
          counts too. */}
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-[var(--dur-150)] group-hover:opacity-100 group-focus-within:opacity-100">
        <CopyButton
          label="Copy username"
          onClick={() => copyField('username')}
          done={copied === 'username'}
        >
          <UserIcon />
        </CopyButton>
        <CopyButton
          label="Copy password"
          onClick={() => copyField('password')}
          done={copied === 'password'}
        >
          <KeyIcon />
        </CopyButton>
      </div>
    </li>
  );
}

function CopyButton({ label, onClick, done, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={[
        'grid size-8 place-items-center rounded-[var(--radius-field)]',
        'transition-colors duration-[var(--dur-150)] active:translate-y-px',
        done
          ? 'text-[var(--color-success)]'
          : 'text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]',
      ].join(' ')}
    >
      {done ? <CheckIcon /> : children}
      {/* Copy success is announced, not only shown as a colour change. */}
      <span className="sr-only" role="status">
        {done ? `${label} — copied` : ''}
      </span>
    </button>
  );
}

/** Deterministic colour from the title, so a row is recognisable at a glance. */
function Favicon({ title }) {
  const hue = [...title].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 360, 7);
  return (
    <div
      className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-field)] text-xs font-semibold text-white"
      style={{ backgroundColor: `oklch(0.6 0.13 ${hue})` }}
      aria-hidden="true"
    >
      {title.slice(0, 1).toUpperCase()}
    </div>
  );
}

const iconProps = {
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: '1.6',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  className: 'size-4',
  'aria-hidden': 'true',
  focusable: 'false',
};

const UserIcon = () => (
  <svg {...iconProps}>
    <circle cx="10" cy="7" r="3" />
    <path d="M4 16.5a6 6 0 0 1 12 0" />
  </svg>
);

const KeyIcon = () => (
  <svg {...iconProps}>
    <circle cx="7" cy="10" r="3" />
    <path d="M10 10h7M15 10v3" />
  </svg>
);

const CheckIcon = () => (
  <svg {...iconProps}>
    <path d="M4 10.5l4 4 8-9" />
  </svg>
);
