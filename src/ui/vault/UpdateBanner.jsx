import { useEffect, useState } from 'preact/hooks';
import { Icon } from './primitives.jsx';
import { updateStatus } from '../lib/messaging.js';

/** Releases the user has dismissed, so a banner is not shown twice. */
const DISMISSED_KEY = 'keyvault.dismissedRelease';

/**
 * "A new version is available."
 *
 * Necessary because of how this is installed: Chrome updates extensions from
 * the Web Store and never one loaded from a folder. Without a banner you keep
 * running the build you happened to install, and a fix you needed can ship
 * without you ever hearing about it.
 *
 * It links, and does nothing else. Nothing is downloaded, and no code is
 * fetched or run — an extension that could update itself from the network
 * would be far more attack surface than this problem is worth.
 *
 * Silent unless there is genuinely something newer: no "you are up to date"
 * banner, nothing while it fails, nothing when switched off. A bar that is
 * usually present is a bar nobody reads.
 */
export function UpdateBanner() {
  const [update, setUpdate] = useState(null);

  useEffect(() => {
    updateStatus()
      .then((result) => {
        if (result.status !== 'ok' || result.updateAvailable !== true) {
          return;
        }
        // Dismissal is per release, not forever: skipping 0.2.0 should not
        // hide 0.3.0 six months later.
        if (localStorage.getItem(DISMISSED_KEY) === result.latestVersion) {
          return;
        }
        setUpdate(result);
      })
      .catch(() => {
        // A failed check is not the user's problem to see. Settings has a
        // "Check now" button for anyone who wants the detail.
      });
  }, []);

  if (update === null) {
    return null;
  }

  return (
    <div
      role="status"
      className={[
        'flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-2',
        'bg-[var(--color-accent)]/10 text-sm',
      ].join(' ')}
    >
      <Icon.Refresh className="size-4 shrink-0 text-[var(--color-accent)]" />

      <span className="min-w-0 flex-1">
        <span className="font-medium">KeyVault {update.latestVersion} is available.</span>{' '}
        <span className="text-[var(--color-fg-muted)]">
          You have {update.installedVersion}. Loaded-from-folder installs do not update themselves —
          you will need to pull and rebuild.
        </span>
      </span>

      {update.url !== null && (
        <a
          href={update.url}
          target="_blank"
          rel="noreferrer noopener"
          className={[
            'shrink-0 rounded-[var(--radius-field)] px-3 py-1 text-xs font-semibold',
            'bg-[var(--color-accent)] text-white',
            'transition-[filter] duration-[var(--dur-150)] hover:brightness-110',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
            'focus-visible:outline-[var(--color-ring)]',
          ].join(' ')}
        >
          What changed
        </a>
      )}

      <button
        type="button"
        aria-label={`Dismiss the notice about version ${update.latestVersion}`}
        onClick={() => {
          localStorage.setItem(DISMISSED_KEY, update.latestVersion);
          setUpdate(null);
        }}
        className={[
          'shrink-0 rounded p-1 text-[var(--color-fg-muted)]',
          'transition-colors duration-[var(--dur-150)] hover:text-[var(--color-fg)]',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
          'focus-visible:outline-[var(--color-ring)]',
        ].join(' ')}
      >
        <Icon.Close className="size-4" />
      </button>
    </div>
  );
}
