import { useId, useState } from 'preact/hooks';

/**
 * Labelled text input with helper and error slots.
 *
 * The label is a real `<label>`, not a placeholder. A placeholder disappears
 * the moment the user types, which leaves anyone who looks away mid-form with
 * no way to recall what the field was — and it is invisible to screen readers
 * as a name.
 */
export function Field({
  label,
  type = 'text',
  error = null,
  hint = null,
  className = '',
  ...props
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const describedBy = [hint !== null ? hintId : null, error !== null ? errorId : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-sm font-medium text-[var(--color-fg)]">
        {label}
      </label>

      <input
        id={id}
        type={type}
        aria-invalid={error !== null || undefined}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        className={[
          'h-10 w-full rounded-[var(--radius-field)] px-3',
          'bg-[var(--color-surface)] text-[var(--color-fg)]',
          'placeholder:text-[var(--color-fg-subtle)]',
          'border transition-colors duration-[var(--dur-150)]',
          error === null
            ? 'border-[var(--color-border-strong)] hover:border-[var(--color-fg-subtle)]'
            : 'border-[var(--color-danger)]',
          'disabled:cursor-not-allowed disabled:opacity-50',
        ].join(' ')}
        {...props}
      />

      {hint !== null && (
        <p id={hintId} className="text-xs text-[var(--color-fg-muted)]">
          {hint}
        </p>
      )}

      {/* Announced when it appears, so the error reaches a screen reader
          without stealing focus from the field the user is correcting. */}
      {error !== null && (
        <p id={errorId} role="alert" className="text-xs font-medium text-[var(--color-danger)]">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Password field with a reveal toggle.
 *
 * Revealing is opt-in and resets on every mount: a popup that reopens showing
 * a plaintext password is a shoulder-surfing hazard.
 *
 * Set `masterPassword` for KeyVault's own master password box. It tells every
 * password manager — Chrome's built-in one included — to keep away from this
 * field. Without it Chrome offers to save the master password and then
 * autofills it on sight, which would put the key to the whole vault inside a
 * different manager and defeat the point of the product.
 */
export function PasswordField({
  label,
  error = null,
  hint = null,
  masterPassword = false,
  ...props
}) {
  const [revealed, setRevealed] = useState(false);

  const managerHints = masterPassword
    ? {
        autoComplete: 'off',
        autocorrect: 'off',
        spellcheck: 'false',
        // Vendor opt-outs. Each manager reads its own attribute, so all
        // three are needed to cover the common ones.
        'data-1p-ignore': '',
        'data-lpignore': 'true',
        'data-bwignore': '',
        'data-form-type': 'other',
      }
    : {};

  return (
    <div className="relative">
      <Field
        label={label}
        type={revealed ? 'text' : 'password'}
        error={error}
        hint={hint}
        className="[&_input]:pr-11"
        {...managerHints}
        {...props}
      />
      <button
        type="button"
        onClick={() => setRevealed((current) => !current)}
        aria-label={revealed ? 'Hide password' : 'Show password'}
        aria-pressed={revealed}
        className={[
          'absolute right-1 top-7 grid size-8 place-items-center',
          'rounded-[var(--radius-field)] text-[var(--color-fg-muted)]',
          'transition-colors duration-[var(--dur-150)]',
          'hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-fg)]',
          'active:translate-y-px',
        ].join(' ')}
      >
        <EyeIcon open={revealed} />
      </button>
    </div>
  );
}

function EyeIcon({ open }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      className="size-4"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M1.5 10S4.8 4.5 10 4.5 18.5 10 18.5 10 15.2 15.5 10 15.5 1.5 10 1.5 10Z" />
      <circle cx="10" cy="10" r="2.5" />
      {!open && <path d="M3 3l14 14" strokeLinecap="round" />}
    </svg>
  );
}
