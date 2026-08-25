import { useId } from 'preact/hooks';

/**
 * Labelled dropdown, matching Field's shape.
 *
 * A native `<select>` rather than a custom listbox: it is keyboard-navigable,
 * screen-reader-correct and touch-friendly for free, and nothing here needs
 * behaviour the platform control does not already have.
 *
 * @param {object} props
 * @param {string} props.label
 * @param {string} props.value
 * @param {(value: string) => void} props.onChange
 * @param {Array<{id: string, label: string}>} props.options
 */
export function Select({ label, value, onChange, options, hint = null, className = '' }) {
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-sm font-medium text-[var(--color-fg)]">
        {label}
      </label>

      <select
        id={id}
        value={value}
        aria-describedby={hint === null ? undefined : hintId}
        onChange={(event) => onChange(event.currentTarget.value)}
        className={[
          'h-10 w-full rounded-[var(--radius-field)] px-3 text-sm',
          'bg-[var(--color-surface)] text-[var(--color-fg)]',
          'border border-[var(--color-border-strong)]',
          'transition-colors duration-[var(--dur-150)]',
          'hover:border-[var(--color-fg-subtle)]',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
          'focus-visible:outline-[var(--color-ring)]',
        ].join(' ')}
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>

      {hint !== null && (
        <p id={hintId} className="text-xs text-[var(--color-fg-muted)]">
          {hint}
        </p>
      )}
    </div>
  );
}
