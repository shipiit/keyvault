import { useState } from 'preact/hooks';
import { Icon } from './primitives.jsx';
import { Button } from '../components/Button.jsx';
import { copyWithAutoClear } from '../lib/messaging.js';
import { changePasswordTarget } from '../../core/change-password-url.js';
import { generatePassword, DEFAULT_OPTIONS } from '../../core/generator.js';

/**
 * "Change it now" — the step that turns a Watchtower finding into a fix.
 *
 * Watchtower can tell you four passwords are reused, and then leave you to
 * find the settings page on four different sites. This closes that gap: a
 * replacement is generated here, and the site's own change-password form is
 * one click away.
 *
 * It deliberately does **not** update the stored entry when you press the
 * button. The new password is not real until the site accepts it, and writing
 * it early is how a manager ends up holding a password that no longer opens
 * anything — the worst outcome available, because the old one is gone too.
 * Instead the existing save prompt does its job: change it on the site, submit,
 * and KeyVault offers to update the entry with what actually worked.
 */
export function ChangePasswordCard({ entry, onClose }) {
  const target = changePasswordTarget(entry);
  const [password, setPassword] = useState(() => generatePassword(DEFAULT_OPTIONS));
  const [copied, setCopied] = useState(false);

  if (target === null) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] p-4">
        <p className="text-sm font-medium">No website saved for this item</p>
        <p className="mt-1 text-xs leading-relaxed text-[var(--color-fg-muted)]">
          Add the site&rsquo;s address to this entry and the change-password page can be opened from
          here. Imported items often arrive without one.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Change this password on {target.host}</h3>
          <p className="mt-0.5 text-xs text-[var(--color-fg-muted)]">
            Copy the new password, change it on the site, and KeyVault will offer to save it.
          </p>
        </div>
        {onClose !== undefined && (
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
          >
            <Icon.Close className="size-4" />
          </button>
        )}
      </div>

      {/* Shown rather than only copied. A password change takes longer than
          the clipboard is allowed to hold anything, so the value has to stay
          somewhere the user can copy again. */}
      <div className="mt-3 flex items-center gap-2 rounded-[var(--radius-field)] bg-[var(--color-field)] p-3">
        <code className="min-w-0 flex-1 break-all font-mono text-sm">{password}</code>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setPassword(generatePassword(DEFAULT_OPTIONS))}
          aria-label="Generate a different password"
        >
          <Icon.Refresh className="size-4" />
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={async () => {
            await copyWithAutoClear(password);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          }}
        >
          {copied ? 'Copied' : 'Copy new password'}
        </Button>

        <Button
          variant="primary"
          size="sm"
          onClick={() => window.open(target.changeUrl, '_blank', 'noopener,noreferrer')}
        >
          Open change page
          <Icon.External className="size-3.5" />
        </Button>
      </div>

      {/* Said plainly rather than discovered as a 404. There is no way to know
          in advance whether a site implements the standard, and finding out
          would mean asking that site about this account — quiet traffic a
          vault has no business generating. */}
      <p className="mt-3 text-xs leading-relaxed text-[var(--color-fg-subtle)]">
        Uses the web standard <code>/.well-known/change-password</code>, which large sites support
        and smaller ones often do not. If you land on a &ldquo;not found&rdquo; page, the site has
        not implemented it —{' '}
        <a
          href={target.siteUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="text-[var(--color-accent)] hover:underline"
        >
          open {target.host}
        </a>{' '}
        and find its account settings instead. KeyVault does not check in advance, because asking
        would tell that site you hold an account there.
      </p>
    </div>
  );
}
