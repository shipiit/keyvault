import { useEffect, useRef, useState } from 'preact/hooks';
import { IconButton, Icon } from './primitives.jsx';
import { Button } from '../components/Button.jsx';
import { Field } from '../components/Field.jsx';
import { GeneratorPopover } from './GeneratorPopover.jsx';
import { assessPassword } from '../../core/password-strength.js';
import { parseOtpauthUri } from '../../core/totp.js';

const TYPES = [
  { id: 'login', label: 'Login', icon: Icon.Lock },
  { id: 'note', label: 'Secure Note', icon: Icon.Note },
  { id: 'card', label: 'Card', icon: Icon.Card },
  { id: 'identity', label: 'Identity', icon: Icon.Identity },
  { id: 'document', label: 'Document', icon: Icon.Document },
];

const EMPTY = {
  title: '',
  username: '',
  password: '',
  url: '',
  notes: '',
  totpUri: '',
  autoSubmit: false,
};

/**
 * Right-hand drawer for creating and editing an item.
 *
 * Used for both, because the fields are identical and two near-copies of a
 * form is where they drift apart.
 */
export function ItemDrawer({ entry = null, onSave, onClose }) {
  const isEdit = entry !== null;
  const [type, setType] = useState('login');
  const [values, setValues] = useState(EMPTY);
  const [showTotp, setShowTotp] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const panelRef = useRef(null);

  useEffect(() => {
    if (entry === null) {
      setValues(EMPTY);
      setShowTotp(false);
      return;
    }
    setType(entry.type ?? 'login');
    setValues({
      title: entry.title ?? '',
      username: entry.username ?? '',
      password: entry.password ?? '',
      url: entry.urls?.[0] ?? '',
      notes: entry.notes ?? '',
      totpUri: '',
      autoSubmit: entry.autoSubmit === true,
    });
    setShowTotp(entry.totp !== null && entry.totp !== undefined);
  }, [entry]);

  // Escape closes, and focus returns to whatever opened the drawer.
  useEffect(() => {
    function handleKey(event) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKey);
    // preventScroll: without it the browser scrolls the focused field to the
    // top of the pane, hiding the item-type selector and the Title label
    // above it the moment the drawer opens.
    panelRef.current?.querySelector('input')?.focus({ preventScroll: true });
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const set = (key) => (event) =>
    setValues((current) => ({ ...current, [key]: event.currentTarget.value }));

  const strength = values.password === '' ? null : assessPassword(values.password);

  function validate() {
    const found = {};
    if (values.title.trim() === '') {
      found.title = 'A title is required';
    }
    if (values.totpUri.trim() !== '') {
      try {
        parseOtpauthUri(values.totpUri.trim());
      } catch (error) {
        // Validated here so a bad QR or pasted URI fails while the user is
        // looking at it, not later when they need the code.
        found.totpUri = error.message;
      }
    }
    setErrors(found);
    return Object.keys(found).length === 0;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!validate() || saving) {
      return;
    }
    setSaving(true);
    try {
      await onSave({ ...values, type });
    } catch (error) {
      setErrors({ form: error.message });
      setSaving(false);
    }
  }

  return (
    <aside
      ref={panelRef}
      role="dialog"
      aria-label={isEdit ? 'Edit item' : 'New item'}
      aria-modal="false"
      className="flex w-[380px] shrink-0 flex-col border-l border-[var(--color-border)] bg-[var(--color-chrome)]"
    >
      <header className="flex items-center justify-between gap-2 px-5 pb-3 pt-5">
        <h2 className="text-lg font-semibold tracking-tight">
          {isEdit ? 'Edit Item' : 'New Item'}
        </h2>
        <IconButton label="Close" onClick={onClose}>
          <Icon.Close />
        </IconButton>
      </header>

      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto px-5 pb-4">
          {!isEdit && (
            <div className="mb-4 grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Item type">
              {TYPES.map((option) => {
                const IconComponent = option.icon;
                const active = type === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    title={option.label}
                    onClick={() => setType(option.id)}
                    className={[
                      'flex flex-col items-center gap-1 rounded-[var(--radius-field)] px-1 py-2.5',
                      'border text-[10px] transition-colors duration-[var(--dur-150)]',
                      'disabled:cursor-not-allowed disabled:opacity-35',
                      active
                        ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/12 text-[var(--color-accent)]'
                        : 'border-[var(--color-border)] text-[var(--color-fg-muted)] hover:border-[var(--color-border-strong)]',
                    ].join(' ')}
                  >
                    <IconComponent className="size-[18px]" />
                    <span className="truncate">{option.label}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex flex-col gap-3.5">
            <Field
              label="Title"
              required
              value={values.title}
              placeholder="e.g. GitHub"
              error={errors.title ?? null}
              onInput={set('title')}
            />

            {type === 'login' && (
              <Field
                label="Username or email"
                value={values.username}
                placeholder="e.g. you@example.com"
                autoComplete="off"
                onInput={set('username')}
              />
            )}

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="drawer-password"
                className="text-sm font-medium text-[var(--color-fg)]"
              >
                Password
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    id="drawer-password"
                    type={revealed ? 'text' : 'password'}
                    value={values.password}
                    placeholder="Enter or generate"
                    autoComplete="off"
                    data-1p-ignore=""
                    data-lpignore="true"
                    onInput={set('password')}
                    className={[
                      'h-10 w-full rounded-[var(--radius-field)] pl-3 pr-10 font-mono text-sm',
                      'bg-[var(--color-surface)] text-[var(--color-fg)]',
                      'border border-[var(--color-border-strong)]',
                      'transition-colors duration-[var(--dur-150)]',
                      'hover:border-[var(--color-fg-subtle)]',
                    ].join(' ')}
                  />
                  <IconButton
                    label={revealed ? 'Hide password' : 'Show password'}
                    aria-pressed={revealed}
                    onClick={() => setRevealed((current) => !current)}
                    className="absolute right-0.5 top-0.5 size-9"
                  >
                    {revealed ? <Icon.EyeOff /> : <Icon.Eye />}
                  </IconButton>
                </div>
                <GeneratorPopover
                  onUse={(generated) =>
                    setValues((current) => ({ ...current, password: generated }))
                  }
                />
              </div>

              {strength !== null && (
                <div className="flex items-center gap-2">
                  <div className="flex h-1 flex-1 gap-1" aria-hidden="true">
                    {[0, 1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="h-full flex-1 rounded-full transition-colors duration-[var(--dur-200)]"
                        style={{
                          backgroundColor:
                            i < strength.score
                              ? [
                                  'var(--color-danger)',
                                  'var(--color-danger)',
                                  'var(--color-warn)',
                                  'var(--color-success)',
                                  'var(--color-success)',
                                ][strength.score]
                              : 'var(--color-border)',
                        }}
                      />
                    ))}
                  </div>
                  <span
                    className="text-xs font-medium text-[var(--color-fg-muted)]"
                    aria-live="polite"
                  >
                    {strength.label}
                  </span>
                </div>
              )}
            </div>

            <label className="flex cursor-pointer items-center justify-between gap-3 py-1">
              <span className="text-sm font-medium">Two-factor code (TOTP)</span>
              <Toggle checked={showTotp} onChange={setShowTotp} label="Enable two-factor code" />
            </label>

            {showTotp && (
              <Field
                label="Setup key or otpauth:// URI"
                value={values.totpUri}
                placeholder="otpauth://totp/… or the secret"
                error={errors.totpUri ?? null}
                hint="Paste the code shown next to the QR image on the site's 2FA page."
                onInput={set('totpUri')}
              />
            )}

            <Field
              label="Website"
              value={values.url}
              placeholder="https://example.com"
              autoComplete="off"
              onInput={set('url')}
            />

            <div className="flex flex-col gap-1.5">
              <label htmlFor="drawer-notes" className="text-sm font-medium text-[var(--color-fg)]">
                Notes
              </label>
              <textarea
                id="drawer-notes"
                rows="3"
                value={values.notes}
                placeholder="Anything worth remembering"
                onInput={set('notes')}
                className={[
                  'w-full resize-y rounded-[var(--radius-field)] p-3 text-sm',
                  'bg-[var(--color-surface)] text-[var(--color-fg)]',
                  'placeholder:text-[var(--color-fg-subtle)]',
                  'border border-[var(--color-border-strong)]',
                  'transition-colors duration-[var(--dur-150)] hover:border-[var(--color-fg-subtle)]',
                ].join(' ')}
              />
            </div>

            <label className="flex cursor-pointer items-start justify-between gap-3 rounded-[var(--radius-field)] border border-[var(--color-border)] p-3">
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">Sign in automatically</span>
                {/* The risk is stated at the point of decision, not buried in
                    settings — this is the one toggle that can hand a
                    credential to a look-alike site. */}
                <span className="text-xs leading-relaxed text-[var(--color-fg-muted)]">
                  Submits the form after filling. Leave off unless you trust this site — a
                  look-alike domain could capture the login before you notice.
                </span>
              </span>
              <Toggle
                checked={values.autoSubmit}
                onChange={(next) => setValues((current) => ({ ...current, autoSubmit: next }))}
                label="Sign in automatically"
              />
            </label>
          </div>

          {errors.form !== undefined && (
            <p role="alert" className="mt-3 text-sm font-medium text-[var(--color-danger)]">
              {errors.form}
            </p>
          )}
        </div>

        <footer className="flex gap-2 border-t border-[var(--color-border)] px-5 py-4">
          <Button variant="secondary" size="md" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="md" className="flex-1" loading={saving}>
            {isEdit ? 'Save changes' : 'Save item'}
          </Button>
        </footer>
      </form>
    </aside>
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={[
        'relative h-6 w-11 shrink-0 rounded-full transition-colors duration-[var(--dur-150)]',
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
