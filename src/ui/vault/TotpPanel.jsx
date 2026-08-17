import { useEffect, useState } from 'preact/hooks';
import { CopyButton, FieldRow, IconButton, Icon } from './primitives.jsx';
import { getTotp, copyWithAutoClear, updateEntryRemote } from '../lib/messaging.js';
import { subscribeToSeconds } from '../lib/ticker.js';
import { Button } from '../components/Button.jsx';

/**
 * The large two-factor code in the detail pane.
 *
 * Like the compact version, the code is fetched from the background on each
 * tick — the TOTP secret never enters a UI context, so the page only ever
 * holds the six digits currently displayed.
 */
export function TotpPanel({ entryId, period = 30, secret = null, onChanged }) {
  const [state, setState] = useState({ status: 'loading', code: '', remaining: period });
  const [showSecret, setShowSecret] = useState(false);

  useEffect(() => {
    let active = true;

    async function refresh() {
      try {
        const { code, remainingSeconds } = await getTotp(entryId);
        if (active) {
          setState({ status: 'ready', code, remaining: remainingSeconds });
        }
      } catch {
        if (active) {
          setState({ status: 'error', code: '', remaining: 0 });
        }
      }
    }

    refresh();
    const unsubscribe = subscribeToSeconds(refresh);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [entryId]);

  if (state.status === 'error') {
    return (
      <FieldRow icon={<Icon.Shield className="size-[18px]" />} label="Two-factor code">
        <span className="text-[var(--color-danger)]">Code unavailable</span>
      </FieldRow>
    );
  }

  if (state.status === 'loading') {
    return (
      <FieldRow icon={<Icon.Shield className="size-[18px]" />} label="Two-factor code">
        <span className="block h-8 w-40 animate-pulse rounded bg-[var(--color-surface-hover)]" />
      </FieldRow>
    );
  }

  // Split 3+3: six digits in an unbroken run are transcribed wrongly far more
  // often than a grouped pair.
  const grouped = `${state.code.slice(0, 3)} ${state.code.slice(3)}`;
  const expiring = state.remaining <= 5;

  return (
    <FieldRow
      icon={<Icon.Shield className="size-[18px]" />}
      label="Two-factor code"
      actions={
        <>
          {secret !== null && (
            <IconButton
              label={showSecret ? 'Hide the setup key' : 'Show the setup key'}
              aria-pressed={showSecret}
              onClick={() => setShowSecret(!showSecret)}
            >
              {showSecret ? <Icon.EyeOff /> : <Icon.Eye />}
            </IconButton>
          )}
          <CopyButton
            label="Copy two-factor code"
            getValue={() => copyWithAutoClear(state.code, 30000)}
          />
        </>
      }
    >
      <div className="flex items-center gap-3">
        <span
          className={[
            'tabular font-mono text-2xl font-semibold tracking-wider',
            'transition-colors duration-[var(--dur-200)]',
            expiring ? 'text-[var(--color-warn)]' : 'text-[var(--color-accent)]',
          ].join(' ')}
          aria-label={`Two-factor code ${state.code.split('').join(' ')}`}
        >
          {grouped}
        </span>
        <Countdown remaining={state.remaining} period={period} urgent={expiring} />
      </div>

      {/* Shown on request so the stored key can be compared against the one
          the site is displaying. Without this, a wrong key is invisible —
          the entry looks correct and produces six digits that are simply
          never accepted. */}
      {showSecret && secret !== null && (
        <div className="mt-2 flex flex-col gap-2">
          <p className="break-all font-mono text-xs text-[var(--color-fg-muted)]">{secret}</p>
          <p className="text-xs leading-relaxed text-[var(--color-fg-subtle)]">
            Compare this with the setup key on the site. If they differ, the wrong key was stored
            and the codes will never be accepted.
          </p>
          <Button
            variant="danger"
            size="sm"
            onClick={async () => {
              await updateEntryRemote(entryId, { totpUri: '' });
              onChanged?.();
            }}
          >
            Remove this key
          </Button>
        </div>
      )}
    </FieldRow>
  );
}

function Countdown({ remaining, period, urgent }) {
  const radius = 13;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.max(0, Math.min(1, remaining / period));

  return (
    <span
      className="relative grid size-8 shrink-0 place-items-center"
      // Announced politely so the count does not interrupt, but a screen
      // reader user still learns the code is about to expire.
      role="timer"
      aria-live="off"
      aria-label={`${remaining} seconds remaining`}
    >
      <svg viewBox="0 0 32 32" className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle
          cx="16"
          cy="16"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.2"
          strokeWidth="2.5"
        />
        <circle
          cx="16"
          cy="16"
          r={radius}
          fill="none"
          stroke={urgent ? 'var(--color-warn)' : 'var(--color-accent)'}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
          className="transition-[stroke-dashoffset] duration-[var(--dur-200)] ease-linear"
        />
      </svg>
      <span
        className={`tabular relative text-[11px] font-semibold ${
          urgent ? 'text-[var(--color-warn)]' : 'text-[var(--color-fg-muted)]'
        }`}
      >
        {remaining}
      </span>
    </span>
  );
}
