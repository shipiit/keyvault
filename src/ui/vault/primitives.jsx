import { useState } from 'preact/hooks';

/**
 * Small building blocks shared across the vault layout.
 *
 * Kept together because each is a handful of lines and they are always used
 * as a set; splitting them into one file apiece would be more navigation for
 * no clarity.
 */

/** Deterministic colour from a title, so an item is recognisable at a glance. */
export function ItemAvatar({ title, size = 'md' }) {
  const hue = [...(title || '?')].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 360, 7);
  const dimensions = { sm: 'size-8 text-xs', md: 'size-10 text-sm', lg: 'size-12 text-lg' };

  return (
    <div
      className={`grid ${dimensions[size]} shrink-0 place-items-center rounded-[var(--radius-card)] font-semibold text-white`}
      style={{ backgroundColor: `oklch(0.62 0.15 ${hue})` }}
      aria-hidden="true"
    >
      {(title || '?').slice(0, 1).toUpperCase()}
    </div>
  );
}

/** Small uppercase pill, e.g. FAVORITE. */
export function Pill({ tone = 'accent', children }) {
  const tones = {
    accent: 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]',
    warn: 'bg-[var(--color-warn)]/15 text-[var(--color-warn)]',
    danger: 'bg-[var(--color-danger)]/15 text-[var(--color-danger)]',
  };
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/** Square icon button with a required accessible label. */
export function IconButton({ label, onClick, active = false, className = '', children, ...props }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={[
        'grid size-9 shrink-0 place-items-center rounded-[var(--radius-field)]',
        'transition-colors duration-[var(--dur-150)] active:translate-y-px',
        'disabled:cursor-not-allowed disabled:opacity-40 disabled:active:translate-y-0',
        active
          ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
          : 'text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-fg)]',
        className,
      ].join(' ')}
      {...props}
    >
      {children}
    </button>
  );
}

/**
 * A copy button that confirms in place.
 *
 * The confirmation is announced as well as shown, because a colour change
 * alone tells a screen-reader user nothing.
 */
export function CopyButton({ label, getValue, className = '' }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleCopy() {
    try {
      await getValue();
      setFailed(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setFailed(true);
      setTimeout(() => setFailed(false), 2000);
    }
  }

  return (
    <IconButton
      label={copied ? `${label} — copied` : label}
      onClick={handleCopy}
      className={className}
    >
      {copied ? <Icon.Check className="text-[var(--color-success)]" /> : <Icon.Copy />}
      {failed && <span className="sr-only">Copy failed</span>}
      <span className="sr-only" role="status">
        {copied ? `${label}: copied to clipboard` : ''}
      </span>
    </IconButton>
  );
}

/** A labelled read-only field row, as used throughout the detail pane. */
export function FieldRow({ icon, label, children, actions = null }) {
  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-card)] bg-[var(--color-field)] px-4 py-3">
      <span className="shrink-0 text-[var(--color-fg-subtle)]" aria-hidden="true">
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-xs font-medium text-[var(--color-fg-muted)]">{label}</span>
        <div className="min-w-0 text-sm text-[var(--color-fg)]">{children}</div>
      </div>
      {actions !== null && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  );
}

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: '1.7',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
  focusable: 'false',
};

// Extra props are forwarded so callers can pass `style`, `title`, and the
// like. Without the spread they are silently dropped, which shows up as an
// icon that ignores the colour it was given.
const make =
  (path) =>
  ({ className = 'size-4', ...rest }) => (
    <svg {...base} className={className} {...rest}>
      {path}
    </svg>
  );

/** Icon set. Stroke-only, one weight, so they sit together as a family. */
export const Icon = {
  Search: make(
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M16.5 16.5 21 21" />
    </>,
  ),
  Grid: make(
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>,
  ),
  List: make(
    <>
      <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </>,
  ),
  Star: ({ className = 'size-4', filled = false, ...rest }) => (
    <svg {...base} className={className} fill={filled ? 'currentColor' : 'none'} {...rest}>
      <path d="m12 3.5 2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8-4.2-4.1 5.9-.9z" />
    </svg>
  ),
  Clock: make(
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 1.8" />
    </>,
  ),
  Trash: make(
    <>
      <path d="M4 7h16M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12" />
    </>,
  ),
  Lock: make(
    <>
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.5" />
      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
    </>,
  ),
  Note: make(
    <>
      <rect x="5" y="3.5" width="14" height="17" rx="2" />
      <path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4" />
    </>,
  ),
  Card: make(
    <>
      <rect x="2.5" y="5.5" width="19" height="13" rx="2.5" />
      <path d="M2.5 10h19" />
    </>,
  ),
  Identity: make(
    <>
      <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
      <circle cx="8.5" cy="10.5" r="2" />
      <path d="M5 16.5a3.5 3.5 0 0 1 7 0M14.5 9.5h4M14.5 13.5h4" />
    </>,
  ),
  Document: make(
    <>
      <path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z" />
      <path d="M14 3.5v5h5" />
    </>,
  ),
  User: make(
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 19.5a7 7 0 0 1 14 0" />
    </>,
  ),
  Shield: make(
    <>
      <path d="M12 3.5 5 6v5.5c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6z" />
    </>,
  ),
  Globe: make(
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.2 2.4 3.3 5.4 3.3 8.5s-1.1 6.1-3.3 8.5c-2.2-2.4-3.3-5.4-3.3-8.5s1.1-6.1 3.3-8.5" />
    </>,
  ),
  Calendar: make(
    <>
      <rect x="3.5" y="5.5" width="17" height="15" rx="2.5" />
      <path d="M3.5 10h17M8 3.5v4M16 3.5v4" />
    </>,
  ),
  Copy: make(
    <>
      <rect x="9" y="9" width="11.5" height="11.5" rx="2" />
      <path d="M15 6.5v-1a2 2 0 0 0-2-2H5.5a2 2 0 0 0-2 2V13a2 2 0 0 0 2 2h1" />
    </>,
  ),
  Check: make(<path d="m5 12.5 4.5 4.5L19 7" />),
  Eye: make(
    <>
      <path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>,
  ),
  EyeOff: make(
    <>
      <path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
      <path d="M3.5 3.5l17 17" />
    </>,
  ),
  Edit: make(
    <>
      <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z" />
    </>,
  ),
  More: make(
    <>
      <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>,
  ),
  External: make(
    <>
      <path d="M14 4h6v6M20 4l-9 9M18 13.5V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V8a1.5 1.5 0 0 1 1.5-1.5H11" />
    </>,
  ),
  Plus: make(<path d="M12 5v14M5 12h14" />),
  Close: make(<path d="M6 6l12 12M18 6L6 18" />),
  Moon: make(<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />),
  Sun: make(
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" />
    </>,
  ),
  Settings: make(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.5 15H3.3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 8.3l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 4.6V4.4a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.3.9z" />
    </>,
  ),
  Chevron: make(<path d="m6 9 6 6 6-6" />),
  Sort: make(<path d="M4 6h16M6 12h12M9 18h6" />),
  Refresh: make(
    <>
      <path d="M20.5 12a8.5 8.5 0 1 1-2.5-6" />
      <path d="M20.5 4v5h-5" />
    </>,
  ),
};
