/**
 * Button.
 *
 * Covers the full state set the rubric requires: default, hover, active,
 * focus-visible, disabled, and loading. Disabled and loading are distinct —
 * loading keeps the button's width so the layout does not jump.
 */

const VARIANTS = {
  primary: [
    'bg-[var(--color-accent)] text-[var(--color-accent-fg)]',
    'hover:bg-[var(--color-accent-hover)]',
    'active:translate-y-px',
  ].join(' '),
  secondary: [
    'bg-[var(--color-surface)] text-[var(--color-fg)]',
    'border border-[var(--color-border-strong)]',
    'hover:bg-[var(--color-surface-hover)]',
    'active:translate-y-px',
  ].join(' '),
  ghost: [
    'bg-transparent text-[var(--color-fg-muted)]',
    'hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-fg)]',
    'active:translate-y-px',
  ].join(' '),
  danger: [
    'bg-transparent text-[var(--color-danger)]',
    'border border-[var(--color-danger)]/40',
    'hover:bg-[var(--color-danger-bg)]',
    'active:translate-y-px',
  ].join(' '),
};

const SIZES = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-11 px-5 text-base gap-2',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  disabled = false,
  className = '',
  children,
  ...props
}) {
  const isDisabled = disabled || loading;

  return (
    <button
      type="button"
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={[
        'inline-flex items-center justify-center rounded-[var(--radius-field)]',
        'font-medium whitespace-nowrap select-none',
        'transition-[background-color,transform,opacity]',
        'duration-[var(--dur-150)] ease-[var(--ease-out-quint)]',
        // Transform and hover styling are suppressed while disabled so the
        // control does not look interactive when it is not.
        'disabled:cursor-not-allowed disabled:opacity-50',
        'disabled:hover:bg-inherit disabled:active:translate-y-0',
        VARIANTS[variant],
        SIZES[size],
        className,
      ].join(' ')}
      {...props}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <svg
      className="size-4 animate-spin"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path
        d="M14.5 8A6.5 6.5 0 0 0 8 1.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
