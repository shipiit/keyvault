import { useState } from 'preact/hooks';
import { ItemAvatar, Icon } from './primitives.jsx';
import { Button } from '../components/Button.jsx';
import { ChangePasswordCard } from './ChangePasswordCard.jsx';

/**
 * Watchtower — the security score, opened up.
 *
 * The score in the sidebar is a summary, and a summary the user cannot act on
 * is decoration. Every point the score deducts comes from a specific entry,
 * so this lists them: grouped by what is wrong, each one a button that opens
 * the item so it can be fixed on the spot.
 *
 * Nothing here recomputes anything. It renders the `issues` the score already
 * produced, so the number in the sidebar and the list here can never disagree.
 */

/** Ordered worst-first, matching the score's own weighting. */
const KINDS = [
  {
    kind: 'breached',
    title: 'Found in a breach',
    body: 'These appeared in a public breach. Change them first, and anywhere else you used the same password.',
    tone: 'var(--color-danger)',
  },
  {
    kind: 'reused',
    title: 'Used more than once',
    body: 'One site being breached exposes every account sharing the password. Give each its own.',
    tone: 'var(--color-danger)',
  },
  {
    kind: 'weak',
    title: 'Easy to guess',
    body: 'Short or predictable enough to fall to an offline guessing attack.',
    tone: 'var(--color-warn)',
  },
  {
    kind: 'old',
    title: 'Unchanged for over a year',
    body: 'Not urgent on its own. Worth doing for anything that matters.',
    tone: 'var(--color-fg-muted)',
  },
];

export function WatchtowerView({ score, entries, onOpenEntry, onOpenSettings }) {
  // Which finding has its change-password card open. One at a time: several
  // generated passwords on screen at once invites pasting the wrong one.
  const [changing, setChanging] = useState(null);
  if (score === null) {
    return (
      <Pane>
        <p className="text-sm text-[var(--color-fg-muted)]">Checking…</p>
      </Pane>
    );
  }

  const byId = new Map((entries ?? []).map((entry) => [entry.id, entry]));
  const groups = KINDS.map((kind) => ({
    ...kind,
    issues: score.issues.filter((issue) => issue.problems.includes(kind.kind)),
  })).filter((group) => group.issues.length > 0);

  const tone =
    score.score >= 90
      ? 'var(--color-success)'
      : score.score >= 75
        ? 'var(--color-accent)'
        : score.score >= 50
          ? 'var(--color-warn)'
          : 'var(--color-danger)';

  return (
    <Pane>
      <div className="mb-6 rounded-[var(--radius-card)] border border-[var(--color-border)] p-5">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-sm font-semibold" style={{ color: tone }}>
            {score.label}
          </span>
          <span className="tabular text-2xl font-bold" style={{ color: tone }}>
            {score.score}%
          </span>
        </div>
        <div
          role="progressbar"
          aria-valuenow={score.score}
          aria-valuemin="0"
          aria-valuemax="100"
          aria-label={`Security score ${score.score} out of 100, ${score.label}`}
          className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[var(--color-border)]"
        >
          <div
            className="h-full rounded-full transition-[width] duration-[var(--dur-200)] ease-[var(--ease-out-quint)]"
            style={{ width: `${score.score}%`, backgroundColor: tone }}
          />
        </div>
        <p className="mt-3 text-xs text-[var(--color-fg-muted)]">
          {score.checked} {score.checked === 1 ? 'password' : 'passwords'} checked, on this device.
          Nothing about your vault is sent anywhere to produce this.
        </p>

        {/* Without this the score reads as a complete check when the most
            serious category was never actually examined. */}
        {!score.breachDataAvailable && score.checked > 0 && (
          <div className="mt-4 flex items-start gap-3 rounded-[var(--radius-field)] bg-[var(--color-field)] p-3">
            <Icon.Shield className="mt-0.5 size-4 shrink-0 text-[var(--color-warn)]" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold">Breach checking is off</p>
              <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-fg-muted)]">
                Nothing here can tell you whether a password has already leaked. The check sends
                only the first five characters of a hash — never a password.
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={onOpenSettings}>
              Turn on
            </Button>
          </div>
        )}
      </div>

      {/* Credentials are audited on expiry and environment, not strength, so
          they get their own section rather than a row in a list about
          passwords. */}
      {score.credentials !== undefined && score.credentials.checked > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold">
            API credentials
            <span className="ml-2 tabular text-xs font-normal text-[var(--color-fg-muted)]">
              {score.credentials.checked}
            </span>
          </h2>
          <p className="mb-3 mt-0.5 max-w-[60ch] text-xs leading-relaxed text-[var(--color-fg-muted)]">
            Judged on whether they still work and where they point — not on how hard they would be
            to guess, which is the issuer&rsquo;s choice rather than yours.
          </p>

          {score.credentials.expired.length === 0 &&
          score.credentials.expiring.length === 0 &&
          score.credentials.misfiled.length === 0 ? (
            <p className="text-xs text-[var(--color-fg-muted)]">
              Nothing expired or expiring. {score.credentials.production} filed as production.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {[
                ...score.credentials.expired.map((c) => ({ ...c, kind: 'expired' })),
                ...score.credentials.expiring.map((c) => ({ ...c, kind: 'expiring' })),
                ...score.credentials.misfiled.map((c) => ({ ...c, kind: 'misfiled' })),
              ].map((item) => (
                <li key={`${item.kind}-${item.id}`}>
                  <button
                    type="button"
                    onClick={() => onOpenEntry(item.id)}
                    className={[
                      'flex w-full items-center gap-3 rounded-[var(--radius-card)] px-4 py-3 text-left',
                      'border border-[var(--color-border)]',
                      'transition-colors duration-[var(--dur-150)]',
                      'hover:border-[var(--color-border-strong)] hover:bg-[var(--color-field)]',
                      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
                      'focus-visible:outline-[var(--color-ring)]',
                    ].join(' ')}
                  >
                    <ItemAvatar title={item.title} size="sm" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">{item.title}</span>
                      <span className="truncate text-xs text-[var(--color-fg-muted)]">
                        {item.provider ?? 'Unknown issuer'} · {item.environment}
                      </span>
                    </span>
                    <span
                      className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                      style={{
                        backgroundColor:
                          item.kind === 'expiring'
                            ? 'color-mix(in srgb, var(--color-warn) 16%, transparent)'
                            : 'color-mix(in srgb, var(--color-danger) 16%, transparent)',
                        color:
                          item.kind === 'expiring' ? 'var(--color-warn)' : 'var(--color-danger)',
                      }}
                    >
                      {item.kind === 'expired' && `Expired ${Math.abs(item.days)}d ago`}
                      {item.kind === 'expiring' && `Expires in ${item.days}d`}
                      {item.kind === 'misfiled' && 'Looks like production'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {groups.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <div className="grid size-11 place-items-center rounded-full bg-[var(--color-success)]/10">
            <Icon.Shield className="size-5 text-[var(--color-success)]" />
          </div>
          <h2 className="text-sm font-semibold">
            {score.checked === 0 ? 'Nothing to check yet' : 'No problems found'}
          </h2>
          <p className="max-w-[40ch] text-xs leading-relaxed text-[var(--color-fg-muted)]">
            {score.checked === 0
              ? 'Save a login and it will be checked here.'
              : 'Every saved password is unique, strong, and recently set.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <section key={group.kind}>
              <h2 className="text-sm font-semibold" style={{ color: group.tone }}>
                {group.title}
                <span className="ml-2 tabular text-xs font-normal text-[var(--color-fg-muted)]">
                  {group.issues.length}
                </span>
              </h2>
              <p className="mb-3 mt-0.5 max-w-[60ch] text-xs leading-relaxed text-[var(--color-fg-muted)]">
                {group.body}
              </p>
              <ul className="flex flex-col gap-1">
                {group.issues.map((issue) => (
                  <li key={issue.id} className="flex flex-col gap-2">
                    {/* A row, not a button containing buttons. Nesting
                        interactive elements is invalid markup and leaves the
                        inner control unreachable by keyboard. */}
                    <div
                      className={[
                        'flex items-center gap-3 rounded-[var(--radius-card)] px-4 py-3',
                        'border border-[var(--color-border)]',
                        'transition-colors duration-[var(--dur-150)]',
                        'hover:border-[var(--color-border-strong)]',
                      ].join(' ')}
                    >
                      <button
                        type="button"
                        onClick={() => onOpenEntry(issue.id)}
                        className={[
                          'flex min-w-0 flex-1 items-center gap-3 rounded text-left',
                          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
                          'focus-visible:outline-[var(--color-ring)]',
                        ].join(' ')}
                      >
                        <ItemAvatar title={issue.title} size="sm" />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-sm font-medium">{issue.title}</span>
                          <span className="truncate text-xs text-[var(--color-fg-muted)]">
                            {byId.get(issue.id)?.username || 'No username'}
                          </span>
                        </span>
                      </button>

                      {/* An entry can be wrong in more than one way, and the
                          other reasons are the argument for fixing it now. */}
                      {issue.problems.length > 1 && (
                        <span className="hidden shrink-0 gap-1 sm:flex">
                          {issue.problems
                            .filter((problem) => problem !== group.kind)
                            .map((problem) => (
                              <span
                                key={problem}
                                className="rounded-full bg-[var(--color-field)] px-2 py-0.5 text-[11px] text-[var(--color-fg-muted)]"
                              >
                                also {problem}
                              </span>
                            ))}
                        </span>
                      )}

                      <button
                        type="button"
                        aria-expanded={changing === issue.id}
                        onClick={() => setChanging(changing === issue.id ? null : issue.id)}
                        className={[
                          'shrink-0 rounded-[var(--radius-field)] px-2.5 py-1 text-xs font-semibold',
                          'bg-[var(--color-accent)] text-white',
                          'transition-[filter] duration-[var(--dur-150)] hover:brightness-110',
                          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
                          'focus-visible:outline-[var(--color-ring)]',
                        ].join(' ')}
                      >
                        {changing === issue.id ? 'Cancel' : 'Change it'}
                      </button>
                    </div>

                    {changing === issue.id && (
                      <ChangePasswordCard
                        entry={byId.get(issue.id) ?? { urls: [] }}
                        onClose={() => setChanging(null)}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Pane>
  );
}

function Pane({ children }) {
  return (
    <section
      aria-label="Watchtower"
      className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-[var(--color-panel)] px-8 py-6"
    >
      <h1 className="text-2xl font-semibold tracking-tight">Watchtower</h1>
      <p className="mb-6 mt-1 text-sm text-[var(--color-fg-muted)]">
        Every problem behind your score, and the item that causes it.
      </p>
      {children}
    </section>
  );
}
