import { useEffect, useState } from 'preact/hooks';
import { getTotp } from '../lib/messaging.js';
import { subscribeToSeconds } from '../lib/ticker.js';

/**
 * A live two-factor code with a countdown ring.
 *
 * The code is fetched from the background rather than computed here: the TOTP
 * secret never enters a UI context. Each refresh is a fresh request, so the
 * popup only ever holds the six digits currently on screen.
 *
 * The ring exists because a code with four seconds left will be rejected by
 * the time the user finishes typing it. Showing the remaining time turns a
 * confusing rejection into an obvious "wait for the next one".
 */
export function TotpCode({ entryId }) {
  const [state, setState] = useState({ status: 'loading', code: null, remaining: 0, period: 30 });

  useEffect(() => {
    let active = true;

    async function refresh() {
      try {
        const { code, remainingSeconds } = await getTotp(entryId);
        if (active) {
          setState({ status: 'ready', code, remaining: remainingSeconds, period: 30 });
        }
      } catch (error) {
        if (active) {
          setState({ status: 'error', code: null, remaining: 0, period: 30, error });
        }
      }
    }

    refresh();
    // One shared clock drives every visible code, rather than one timer per
    // row. See lib/ticker.js.
    const unsubscribe = subscribeToSeconds(refresh);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [entryId]);

  if (state.status === 'loading') {
    return <div className="h-6 w-24 animate-pulse rounded bg-[var(--color-surface-hover)]" />;
  }

  if (state.status === 'error') {
    return <span className="text-xs text-[var(--color-danger)]">2FA code unavailable</span>;
  }

  // Grouped 3+3: six digits in a row are transcribed wrongly far more often.
  const grouped = `${state.code.slice(0, 3)} ${state.code.slice(3)}`;
  const expiringSoon = state.remaining <= 5;

  return (
    <span className="inline-flex items-center gap-2">
      <CountdownRing remaining={state.remaining} period={state.period} urgent={expiringSoon} />
      <span
        className={[
          'tabular font-mono text-base font-semibold tracking-wide',
          'transition-colors duration-[var(--dur-200)]',
          expiringSoon ? 'text-[var(--color-warn)]' : 'text-[var(--color-fg)]',
        ].join(' ')}
        aria-label={`Two-factor code ${state.code.split('').join(' ')}, ${state.remaining} seconds remaining`}
      >
        {grouped}
      </span>
    </span>
  );
}

function CountdownRing({ remaining, period, urgent }) {
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.max(0, Math.min(1, remaining / period));

  return (
    <svg viewBox="0 0 18 18" className="size-4 -rotate-90" aria-hidden="true" focusable="false">
      <circle
        cx="9"
        cy="9"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.2"
        strokeWidth="2"
      />
      <circle
        cx="9"
        cy="9"
        r={radius}
        fill="none"
        stroke={urgent ? 'var(--color-warn)' : 'var(--color-accent)'}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - progress)}
        className="transition-[stroke-dashoffset] duration-[var(--dur-200)] ease-linear"
      />
    </svg>
  );
}
