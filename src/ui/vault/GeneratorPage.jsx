import { useEffect, useState } from 'preact/hooks';
import { Icon } from './primitives.jsx';
import { Button } from '../components/Button.jsx';
import { copyWithAutoClear } from '../lib/messaging.js';
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

/**
 * The generator as a place of its own.
 *
 * Generating a password is something people do deliberately, not only while
 * filling a form, so it gets a page rather than living solely inside the item
 * editor.
 *
 * Everything runs locally on the vault's own CSPRNG — nothing is requested
 * from anywhere, which is worth saying plainly given how many online
 * generators exist.
 */
export function GeneratorPage() {
  const [mode, setMode] = useState('password');
  const [options, setOptions] = useState({ ...DEFAULT_OPTIONS });
  const [words, setWords] = useState(4);
  const [includeNumber, setIncludeNumber] = useState(true);
  const [value, setValue] = useState('');
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState([]);

  function regenerate() {
    try {
      const next =
        mode === 'password'
          ? generatePassword(options)
          : generatePassphrase({ words, includeNumber, capitalize: true });
      setValue(next);
      // Kept in memory only, and only for this page's lifetime: a password
      // generated a minute ago and pasted into a form that failed is
      // otherwise gone for good.
      setHistory((current) => [next, ...current].slice(0, 5));
    } catch {
      setValue('');
    }
  }

  useEffect(regenerate, [mode, options, words, includeNumber]);

  const bits =
    mode === 'password'
      ? passwordEntropyBits(options)
      : passphraseEntropyBits({ words, includeNumber });

  const noClass =
    mode === 'password' &&
    !options.lowercase &&
    !options.uppercase &&
    !options.digits &&
    !options.symbols;

  // Thresholds follow the same scale the strength meter uses elsewhere, so a
  // generated password and a typed one are judged alike.
  const strength =
    bits >= 90
      ? { label: 'Very strong', tone: 'var(--color-success)', fill: 1 }
      : bits >= 60
        ? { label: 'Strong', tone: 'var(--color-success)', fill: 0.75 }
        : bits >= 42
          ? { label: 'Fair', tone: 'var(--color-warn)', fill: 0.5 }
          : { label: 'Weak', tone: 'var(--color-danger)', fill: 0.25 };

  return (
    <section
      aria-label="Password generator"
      className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-[var(--color-panel)] px-8 py-6"
    >
      <h1 className="text-2xl font-semibold tracking-tight">Password generator</h1>
      <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
        Generated on this device, from the same random source that protects your vault. Nothing is
        requested from anywhere.
      </p>

      <div className="mt-6 flex max-w-2xl flex-col gap-5">
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] p-5">
          <div
            className={[
              'min-h-[56px] break-all rounded-[var(--radius-field)] p-4 font-mono text-lg',
              'bg-[var(--color-field)]',
              noClass ? 'text-[var(--color-danger)]' : '',
            ].join(' ')}
            aria-live="polite"
          >
            {noClass ? 'Enable at least one character type' : value}
          </div>

          <div className="mt-3 flex items-center gap-3">
            <div
              role="progressbar"
              aria-valuenow={bits}
              aria-valuemin="0"
              aria-valuemax="128"
              aria-label={`Strength ${strength.label}, ${bits} bits of entropy`}
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-border)]"
            >
              <div
                className="h-full rounded-full transition-[width] duration-[var(--dur-200)]"
                style={{ width: `${strength.fill * 100}%`, backgroundColor: strength.tone }}
              />
            </div>
            <span className="text-sm font-semibold" style={{ color: strength.tone }}>
              {strength.label}
            </span>
            <span className="tabular text-xs text-[var(--color-fg-muted)]">{bits} bits</span>
          </div>

          <div className="mt-4 flex gap-2">
            <Button
              variant="primary"
              size="md"
              disabled={value === ''}
              onClick={async () => {
                await copyWithAutoClear(value);
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              }}
            >
              {copied ? 'Copied' : 'Copy password'}
            </Button>
            <Button variant="secondary" size="md" onClick={regenerate}>
              <Icon.Refresh className="size-4" />
              Generate another
            </Button>
          </div>
        </div>

        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] p-5">
          <div className="mb-4 flex gap-1 rounded-[var(--radius-field)] bg-[var(--color-field)] p-1">
            {[
              ['password', 'Random password'],
              ['passphrase', 'Memorable words'],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setMode(id)}
                aria-pressed={mode === id}
                className={[
                  'flex-1 rounded py-1.5 text-sm font-medium transition-colors duration-[var(--dur-150)]',
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
              <div className="mt-3 grid grid-cols-2 gap-x-6">
                {[
                  ['uppercase', 'Uppercase (A–Z)'],
                  ['lowercase', 'Lowercase (a–z)'],
                  ['digits', 'Numbers (0–9)'],
                  ['symbols', 'Symbols (!@#)'],
                  ['avoidAmbiguous', 'Avoid look-alikes'],
                ].map(([key, label]) => (
                  <Check
                    key={key}
                    label={label}
                    checked={options[key] === true}
                    onChange={(next) => setOptions((current) => ({ ...current, [key]: next }))}
                  />
                ))}
              </div>
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
              <div className="mt-3">
                <Check
                  label="Include a number"
                  checked={includeNumber}
                  onChange={setIncludeNumber}
                />
              </div>
              <p className="mt-3 text-xs leading-relaxed text-[var(--color-fg-subtle)]">
                Uses a built-in {wordlistSize()}-word list. Easier to remember, but a random
                password of the same length is stronger.
              </p>
            </>
          )}
        </div>

        {history.length > 1 && (
          <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] p-5">
            <h2 className="text-sm font-semibold">Recently generated</h2>
            <p className="mt-0.5 text-xs text-[var(--color-fg-muted)]">
              Held in this page only, and gone when you close it.
            </p>
            <ul className="mt-3 flex flex-col gap-1">
              {history.slice(1).map((entry, index) => (
                <li
                  key={`${entry}-${index}`}
                  className="flex items-center gap-2 rounded-[var(--radius-field)] bg-[var(--color-field)] px-3 py-2"
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{entry}</span>
                  <Button variant="ghost" size="sm" onClick={() => copyWithAutoClear(entry)}>
                    Copy
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function Slider({ label, value, min, max, onChange }) {
  return (
    <label className="flex items-center gap-4">
      <span className="w-20 shrink-0 text-sm text-[var(--color-fg-muted)]">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onInput={(event) => onChange(Number(event.currentTarget.value))}
        className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-[var(--color-border-strong)] accent-[var(--color-accent)]"
      />
      <span className="tabular w-8 text-right text-sm font-semibold">{value}</span>
    </label>
  );
}

function Check({ label, checked, onChange }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 py-1.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
        className="size-4 accent-[var(--color-accent)]"
      />
      <span className="text-sm text-[var(--color-fg-muted)]">{label}</span>
    </label>
  );
}
