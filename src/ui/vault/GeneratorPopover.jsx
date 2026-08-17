import { useEffect, useRef, useState } from 'preact/hooks';
import { IconButton, Icon } from './primitives.jsx';
import { Button } from '../components/Button.jsx';
import {
  generatePassword,
  generatePassphrase,
  passwordEntropyBits,
  passphraseEntropyBits,
  wordlistSize,
  DEFAULT_OPTIONS,
  MIN_LENGTH,
  MAX_LENGTH,
  MIN_WORDS,
  MAX_WORDS,
} from '../../core/generator.js';
import { copyWithAutoClear } from '../lib/messaging.js';

/**
 * Password generator.
 *
 * Generation runs locally, in this page, using the vault's own CSPRNG helpers
 * — there is no round-trip and no service involved. Every option change
 * regenerates immediately so the user sees the effect of what they changed.
 */
export function GeneratorPopover({ onUse }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('password');
  const [options, setOptions] = useState({ ...DEFAULT_OPTIONS });
  const [words, setWords] = useState(4);
  const [includeNumber, setIncludeNumber] = useState(true);
  const [value, setValue] = useState('');
  const [copied, setCopied] = useState(false);
  const containerRef = useRef(null);

  function regenerate() {
    try {
      setValue(
        mode === 'password'
          ? generatePassword(options)
          : generatePassphrase({ words, includeNumber, capitalize: true }),
      );
    } catch {
      // Every character class disabled. Say so rather than showing a stale
      // password that no longer matches the settings.
      setValue('');
    }
  }

  useEffect(() => {
    if (open) {
      regenerate();
    }
    // Regenerating on every option change is the point: the preview must
    // always match the controls.
  }, [open, mode, options, words, includeNumber]);

  // Close on outside click or Escape, like any popover.
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    function handlePointer(event) {
      if (!containerRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }
    function handleKey(event) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handlePointer);
    window.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      window.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const bits =
    mode === 'password'
      ? passwordEntropyBits(options)
      : passphraseEntropyBits({ words, includeNumber });

  const noClassEnabled =
    mode === 'password' &&
    !options.lowercase &&
    !options.uppercase &&
    !options.digits &&
    !options.symbols;

  return (
    <div ref={containerRef} className="relative">
      <Button variant="secondary" size="md" onClick={() => setOpen((current) => !current)}>
        Generate
      </Button>

      {open && (
        <div
          role="dialog"
          aria-label="Password generator"
          className={[
            'absolute right-0 top-full z-20 mt-2 w-[340px]',
            'rounded-[var(--radius-card)] border border-[var(--color-border)]',
            'bg-[var(--color-panel)] p-4 shadow-xl',
          ].join(' ')}
        >
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Password Generator</h3>
            <IconButton label="Close generator" onClick={() => setOpen(false)} className="size-7">
              <Icon.Close />
            </IconButton>
          </div>

          <div
            className={[
              'mb-3 min-h-[64px] break-all rounded-[var(--radius-field)] p-3',
              'bg-[var(--color-field)] font-mono text-sm',
              noClassEnabled ? 'text-[var(--color-danger)]' : '',
            ].join(' ')}
            aria-live="polite"
          >
            {noClassEnabled ? 'Enable at least one character type' : value}
          </div>

          <div className="mb-4 flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="flex-1"
              disabled={value === ''}
              onClick={async () => {
                await copyWithAutoClear(value);
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <IconButton label="Generate another" onClick={regenerate}>
              <Icon.Refresh />
            </IconButton>
            <Button
              variant="primary"
              size="sm"
              className="flex-1"
              disabled={value === ''}
              onClick={() => {
                onUse(value);
                setOpen(false);
              }}
            >
              Use
            </Button>
          </div>

          <div className="mb-3 flex gap-1 rounded-[var(--radius-field)] bg-[var(--color-field)] p-1">
            {[
              ['password', 'Random'],
              ['passphrase', 'Memorable'],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setMode(id)}
                aria-pressed={mode === id}
                className={[
                  'flex-1 rounded py-1.5 text-xs font-medium transition-colors duration-[var(--dur-150)]',
                  mode === id
                    ? 'bg-[var(--color-surface)] text-[var(--color-fg)] shadow-sm'
                    : 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === 'password' ? (
            <>
              <Slider
                label="Length"
                value={options.length}
                min={MIN_LENGTH}
                max={MAX_LENGTH}
                onChange={(length) => setOptions((current) => ({ ...current, length }))}
              />
              {[
                ['uppercase', 'Uppercase (A–Z)'],
                ['lowercase', 'Lowercase (a–z)'],
                ['digits', 'Numbers (0–9)'],
                ['symbols', 'Symbols (!@#)'],
                ['avoidAmbiguous', 'Avoid look-alike characters'],
              ].map(([key, label]) => (
                <Row
                  key={key}
                  label={label}
                  checked={options[key]}
                  onChange={(next) => setOptions((current) => ({ ...current, [key]: next }))}
                />
              ))}
            </>
          ) : (
            <>
              <Slider
                label="Words"
                value={words}
                min={MIN_WORDS}
                max={MAX_WORDS}
                onChange={setWords}
              />
              <Row label="Include a number" checked={includeNumber} onChange={setIncludeNumber} />
              {/* The bundled wordlist is small, and pretending otherwise
                  would overstate the strength of every passphrase. */}
              <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-fg-subtle)]">
                Uses a built-in {wordlistSize()}-word list. Memorable, but a random password of the
                same length is stronger.
              </p>
            </>
          )}

          <p className="mt-3 border-t border-[var(--color-border)] pt-3 text-xs text-[var(--color-fg-muted)]">
            Strength: <span className="tabular font-semibold text-[var(--color-fg)]">{bits}</span>{' '}
            bits of entropy
          </p>
        </div>
      )}
    </div>
  );
}

function Slider({ label, value, min, max, onChange }) {
  return (
    <label className="mb-3 flex items-center gap-3">
      <span className="w-16 shrink-0 text-xs text-[var(--color-fg-muted)]">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onInput={(e) => onChange(Number(e.currentTarget.value))}
        className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-[var(--color-border-strong)] accent-[var(--color-accent)]"
      />
      <span className="tabular w-8 shrink-0 text-right text-xs font-semibold">{value}</span>
    </label>
  );
}

function Row({ label, checked, onChange }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1.5">
      <span className="text-xs text-[var(--color-fg-muted)]">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={[
          'relative h-5 w-9 shrink-0 rounded-full transition-colors duration-[var(--dur-150)]',
          checked ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border-strong)]',
        ].join(' ')}
      >
        <span
          className={[
            'absolute top-0.5 size-4 rounded-full bg-white shadow',
            'transition-[left] duration-[var(--dur-150)] ease-[var(--ease-out-quint)]',
            checked ? 'left-[18px]' : 'left-0.5',
          ].join(' ')}
        />
      </button>
    </label>
  );
}
