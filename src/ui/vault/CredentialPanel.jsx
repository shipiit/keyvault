import { Icon } from './primitives.jsx';
import { describeCredential, CREDENTIAL_TYPES, ENVIRONMENTS } from '../../core/api-credential.js';

/**
 * What a stored API credential is, shown without showing the credential.
 *
 * The panel leads with the two facts that change how a key should be handled
 * — who issued it and whether it points at production — because those are
 * what someone needs before deciding to copy it anywhere. The secret itself
 * stays masked; the existing reveal and copy controls handle that, and
 * duplicating them here would mean a second place to get wrong.
 */
export function CredentialPanel({ entry }) {
  const described = describeCredential(entry);
  const credential = entry.fields?.credential ?? {};
  const typeLabel =
    CREDENTIAL_TYPES.find((t) => t.id === credential.credentialType)?.label ?? 'API key';
  const environment =
    ENVIRONMENTS.find((e) => e.id === described.environment) ?? ENVIRONMENTS.at(-1);

  const status = described.status;
  const tone =
    status.state === 'expired'
      ? 'var(--color-danger)'
      : status.state === 'expiring'
        ? 'var(--color-warn)'
        : 'var(--color-fg-muted)';

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {described.provider !== null && (
          <span className="rounded-full bg-[var(--color-field)] px-2.5 py-1 text-xs font-semibold">
            {described.provider} · {described.kind}
          </span>
        )}
        <span
          className="rounded-full px-2.5 py-1 text-xs font-semibold"
          style={{
            backgroundColor: environment.severe
              ? 'color-mix(in srgb, var(--color-danger) 15%, transparent)'
              : 'var(--color-field)',
            color: environment.severe ? 'var(--color-danger)' : 'var(--color-fg-muted)',
          }}
        >
          {environment.label}
        </span>
        <span className="rounded-full bg-[var(--color-field)] px-2.5 py-1 text-xs text-[var(--color-fg-muted)]">
          {typeLabel}
        </span>
      </div>

      {/* The mismatch that gets a live key treated like a test one. */}
      {described.misfiled && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-[var(--radius-field)] bg-[var(--color-danger)]/10 p-3 text-xs leading-relaxed text-[var(--color-danger)]"
        >
          <Icon.Shield className="mt-px size-4 shrink-0" />
          This key looks like a production credential, but it is filed as{' '}
          {environment.label.toLowerCase()}. Check before treating it as safe to share.
        </p>
      )}

      <dl className="grid grid-cols-2 gap-4 text-sm">
        <div className="col-span-2">
          <dt className="text-xs text-[var(--color-fg-muted)]">Credential</dt>
          <dd className="mt-0.5 break-all font-mono text-sm">{described.masked}</dd>
        </div>

        {credential.hostname !== undefined && credential.hostname !== '' && (
          <div className="col-span-2">
            <dt className="text-xs text-[var(--color-fg-muted)]">Hostname</dt>
            <dd className="mt-0.5 font-mono text-sm">{credential.hostname}</dd>
          </div>
        )}

        <div>
          <dt className="text-xs text-[var(--color-fg-muted)]">Valid from</dt>
          <dd className="mt-0.5">{formatDate(credential.validFrom)}</dd>
        </div>

        <div>
          <dt className="text-xs text-[var(--color-fg-muted)]">Expires</dt>
          <dd className="mt-0.5" style={{ color: tone }}>
            {formatDate(credential.expires)}
            {status.state === 'expired' && ` · expired ${Math.abs(status.days)}d ago`}
            {status.state === 'expiring' && ` · in ${status.days}d`}
            {status.state === 'pending' && ` · not yet valid`}
          </dd>
        </div>
      </dl>

      {status.state === 'none' && (
        <p className="text-xs leading-relaxed text-[var(--color-fg-subtle)]">
          No expiry recorded. Plenty of keys never expire — but if this one does, adding the date is
          what puts it in Watchtower before it stops working rather than after.
        </p>
      )}
    </section>
  );
}

function formatDate(value) {
  if (typeof value !== 'number') {
    return '—';
  }
  return new Date(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
