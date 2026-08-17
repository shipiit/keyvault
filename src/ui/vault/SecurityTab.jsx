import { useState } from 'preact/hooks';
import { Icon } from './primitives.jsx';
import { Button } from '../components/Button.jsx';
import { assessPassword, timeToCrack } from '../../core/password-strength.js';
import { send } from '../lib/messaging.js';

const TONES = [
  'var(--color-danger)',
  'var(--color-danger)',
  'var(--color-warn)',
  'var(--color-success)',
  'var(--color-success)',
];

/**
 * Per-item security assessment.
 *
 * Strength is computed locally and always shown. The breach check is a
 * separate, explicit action: it is the only thing in KeyVault that makes a
 * network request, so it never runs merely because a tab was opened.
 */
export function SecurityTab({ entry }) {
  const assessment = assessPassword(entry.password ?? '');
  const [breach, setBreach] = useState({ status: 'idle' });

  async function runBreachCheck() {
    setBreach({ status: 'checking' });
    try {
      const result = await send('security/checkBreach', { id: entry.id });
      setBreach({ status: 'done', result });
    } catch (error) {
      setBreach({ status: 'failed', message: error.message });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-[var(--radius-card)] bg-[var(--color-field)] p-5">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-medium text-[var(--color-fg-muted)]">Password strength</h2>
          <span
            className="text-sm font-semibold"
            style={{ color: TONES[assessment.score] }}
            aria-live="polite"
          >
            {assessment.label}
          </span>
        </div>

        <div className="flex h-1.5 gap-1" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-full flex-1 rounded-full transition-colors duration-[var(--dur-200)]"
              style={{
                backgroundColor:
                  i < assessment.score ? TONES[assessment.score] : 'var(--color-border)',
              }}
            />
          ))}
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-xs text-[var(--color-fg-muted)]">Estimated entropy</dt>
            <dd className="tabular font-medium">{assessment.entropyBits} bits</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-fg-muted)]">Time to crack</dt>
            <dd className="font-medium">{timeToCrack(assessment.entropyBits)}</dd>
          </div>
        </dl>

        {/* Stated so the number is not mistaken for a promise. */}
        <p className="mt-3 text-xs text-[var(--color-fg-subtle)]">
          Assumes an offline attack at 100 billion guesses per second — the attacker&rsquo;s best
          case, not yours.
        </p>

        {assessment.warning !== null && (
          <p className="mt-3 flex items-start gap-2 text-xs text-[var(--color-warn)]">
            <Icon.Shield className="mt-px size-4 shrink-0" />
            {assessment.warning}
          </p>
        )}

        {assessment.suggestions.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1">
            {assessment.suggestions.map((suggestion) => (
              <li key={suggestion} className="text-xs text-[var(--color-fg-muted)]">
                • {suggestion}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-[var(--radius-card)] bg-[var(--color-field)] p-5">
        <h2 className="text-sm font-medium text-[var(--color-fg-muted)]">Breach check</h2>

        {breach.status === 'idle' && (
          <>
            <p className="mt-2 text-xs leading-relaxed text-[var(--color-fg-muted)]">
              Checks whether this password appears in public breach data. Only the first five
              characters of its hash are sent, so the service cannot tell which password was
              checked. This is the only feature that uses the network.
            </p>
            <Button variant="secondary" size="sm" className="mt-3" onClick={runBreachCheck}>
              Check this password
            </Button>
          </>
        )}

        {breach.status === 'checking' && (
          <p className="mt-2 text-sm text-[var(--color-fg-muted)]" aria-live="polite">
            Checking…
          </p>
        )}

        {breach.status === 'failed' && (
          <p className="mt-2 text-sm text-[var(--color-danger)]" role="alert">
            {breach.message}
          </p>
        )}

        {breach.status === 'done' && <BreachResult result={breach.result} />}
      </section>
    </div>
  );
}

function BreachResult({ result }) {
  if (result.status === 'disabled') {
    return (
      <p className="mt-2 text-sm text-[var(--color-fg-muted)]">
        Breach checking is switched off in settings.
      </p>
    );
  }

  if (result.status === 'unavailable') {
    // Never reported as "safe": a failed check is unknown, not clean.
    return (
      <p className="mt-2 flex items-start gap-2 text-sm text-[var(--color-warn)]" role="alert">
        <Icon.Shield className="mt-0.5 size-4 shrink-0" />
        Could not check right now ({result.reason}). This is not a clean result — try again later.
      </p>
    );
  }

  const tone = result.breached ? 'var(--color-danger)' : 'var(--color-success)';

  return (
    <div className="mt-3 flex items-start gap-3" aria-live="polite">
      <Icon.Shield className="mt-0.5 size-5 shrink-0" style={{ color: tone }} />
      <div className="flex flex-col gap-1">
        <span className="text-sm font-semibold" style={{ color: tone }}>
          {result.exposure.title}
        </span>
        <p className="text-xs leading-relaxed text-[var(--color-fg-muted)]">
          {result.exposure.detail}
        </p>
      </div>
    </div>
  );
}
