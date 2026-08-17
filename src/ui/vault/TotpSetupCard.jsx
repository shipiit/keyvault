import { useState } from 'preact/hooks';
import { Icon } from './primitives.jsx';
import { Button } from '../components/Button.jsx';
import { scanActiveTabForTotp, updateEntryRemote } from '../lib/messaging.js';
import { parseOtpauthUri } from '../../core/totp.js';

/**
 * Offer to add a two-factor code to an item that has none.
 *
 * Shown in the detail pane rather than only inside the edit form. Setting up
 * 2FA happens while the user is looking at the site's setup page, and
 * requiring them to open the editor and find a toggle first is two steps
 * more than the moment allows.
 */
export function TotpSetupCard({ entryId, onAdded }) {
  const [state, setState] = useState({ status: 'idle' });
  const [manual, setManual] = useState(null);

  async function save(value) {
    setState({ status: 'saving' });
    try {
      // Validated here so a bad key fails while the user is still looking at
      // the setup page, not weeks later when they need the code.
      const raw = value.trim();
      if (raw.toLowerCase().startsWith('otpauth://')) {
        parseOtpauthUri(raw);
      }
      await updateEntryRemote(entryId, { totpUri: raw });
      setState({ status: 'idle' });
      setManual(null);
      onAdded();
    } catch (error) {
      setState({ status: 'failed', reason: error.message });
    }
  }

  async function scan() {
    setState({ status: 'scanning' });
    const result = await scanActiveTabForTotp();
    if (!result.found) {
      setState({ status: 'failed', reason: result.reason });
      return;
    }
    await save(result.uri ?? result.secret);
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border-strong)] p-4">
      <div className="flex items-start gap-3">
        <Icon.Shield className="mt-0.5 size-[18px] shrink-0 text-[var(--color-fg-subtle)]" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-sm font-medium">Two-factor code</span>
          <p className="text-xs leading-relaxed text-[var(--color-fg-muted)]">
            Not set up. Open this site&rsquo;s two-factor page in another tab, then scan it —
            KeyVault reads the setup key printed beside the QR code.
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="primary"
          size="sm"
          loading={state.status === 'scanning' || state.status === 'saving'}
          onClick={scan}
        >
          <Icon.Search className="size-4" />
          Scan this page
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setManual(manual === null ? '' : null)}
          aria-expanded={manual !== null}
        >
          Enter key manually
        </Button>
      </div>

      {manual !== null && (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (manual.trim() !== '') {
              save(manual);
            }
          }}
        >
          <label htmlFor="totp-manual" className="sr-only">
            Setup key or otpauth URI
          </label>
          <input
            id="totp-manual"
            value={manual}
            autoFocus
            placeholder="otpauth://totp/… or the setup key"
            autoComplete="off"
            data-1p-ignore=""
            data-lpignore="true"
            onInput={(event) => setManual(event.currentTarget.value)}
            className={[
              'h-9 flex-1 rounded-[var(--radius-field)] px-3 font-mono text-xs',
              'bg-[var(--color-surface)] text-[var(--color-fg)]',
              'placeholder:text-[var(--color-fg-subtle)]',
              'border border-[var(--color-border-strong)]',
              'transition-colors duration-[var(--dur-150)] hover:border-[var(--color-fg-subtle)]',
            ].join(' ')}
          />
          <Button type="submit" variant="primary" size="sm" disabled={manual.trim() === ''}>
            Add
          </Button>
        </form>
      )}

      {state.status === 'failed' && (
        <p role="alert" className="mt-2 text-xs leading-relaxed text-[var(--color-warn)]">
          {state.reason}
        </p>
      )}
    </div>
  );
}
