import { useEffect, useState } from 'preact/hooks';
import { ItemAvatar, Pill, IconButton, CopyButton, FieldRow, Icon } from './primitives.jsx';
import { Button } from '../components/Button.jsx';
import { TotpPanel } from './TotpPanel.jsx';
import { SecurityTab } from './SecurityTab.jsx';
import { getEntry, copyWithAutoClear } from '../lib/messaging.js';
import { relativeTime } from './ItemList.jsx';

const TABS = [
  { id: 'details', label: 'Details' },
  { id: 'security', label: 'Security' },
  { id: 'history', label: 'History' },
];

/**
 * Right pane: everything about one item.
 *
 * The full record — including the password — is fetched here, on selection,
 * and dropped when the selection changes. It is never held for the whole
 * session, and the password is masked until explicitly revealed.
 */
export function ItemDetail({ entryId, onEdit, onClose, compact = false }) {
  const [entry, setEntry] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('details');
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    let active = true;
    setEntry(null);
    setError(null);
    // Revealing resets on every selection: a password left visible while the
    // user moves through the list is a shoulder-surfing hazard.
    setRevealed(false);
    setTab('details');

    getEntry(entryId)
      .then(({ entry: full }) => active && setEntry(full))
      .catch((caught) => active && setError(caught.message));

    return () => {
      active = false;
    };
  }, [entryId]);

  if (error !== null) {
    return (
      <Pane>
        <p role="alert" className="p-8 text-sm text-[var(--color-danger)]">
          {error}
        </p>
      </Pane>
    );
  }

  if (entry === null) {
    return (
      <Pane>
        <div className="flex flex-col gap-3 p-8" aria-busy="true">
          <div className="h-12 w-1/3 animate-pulse rounded bg-[var(--color-surface-hover)]" />
          <div className="h-16 animate-pulse rounded-[var(--radius-card)] bg-[var(--color-surface-hover)]" />
          <div className="h-16 animate-pulse rounded-[var(--radius-card)] bg-[var(--color-surface-hover)]" />
        </div>
      </Pane>
    );
  }

  return (
    <Pane>
      <header
        className={`flex items-start gap-3 ${compact ? 'px-4 pb-3 pt-4' : 'gap-4 px-8 pb-4 pt-6'}`}
      >
        <ItemAvatar title={entry.title} size={compact ? 'md' : 'lg'} />
        <div className="flex min-w-0 flex-1 flex-col gap-1 pt-1">
          <div className="flex items-center gap-2">
            <h1
              className={`truncate font-semibold tracking-tight ${compact ? 'text-lg' : 'text-2xl'}`}
            >
              {entry.title}
            </h1>
            {entry.favorite && <Pill>Favorite</Pill>}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => onEdit(entry)}>
            <Icon.Edit className="size-4" />
            {compact ? '' : 'Edit'}
          </Button>
          <CopyButton label="Copy password" getValue={() => copyWithAutoClear(entry.password)} />
          <IconButton label="More actions">
            <Icon.More />
          </IconButton>
          <IconButton label="Close details" onClick={onClose}>
            <Icon.Close />
          </IconButton>
        </div>
      </header>

      <div
        role="tablist"
        aria-label="Item sections"
        className={`flex gap-1 border-b border-[var(--color-border)] ${compact ? 'px-4' : 'px-8'}`}
      >
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={[
              'relative px-3 py-2.5 text-sm transition-colors duration-[var(--dur-150)]',
              tab === item.id
                ? 'font-medium text-[var(--color-fg)]'
                : 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]',
            ].join(' ')}
          >
            {item.label}
            {tab === item.id && (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-[var(--color-accent)]" />
            )}
          </button>
        ))}
      </div>

      <div className={`flex-1 overflow-y-auto ${compact ? 'px-4 py-3' : 'px-8 py-5'}`}>
        {tab === 'details' && (
          <DetailsTab entry={entry} revealed={revealed} onToggleReveal={setRevealed} />
        )}
        {tab === 'security' && <SecurityTab entry={entry} />}
        {tab === 'history' && <HistoryTab entry={entry} />}
      </div>
    </Pane>
  );
}

function Pane({ children }) {
  return (
    <section
      aria-label="Item details"
      className="flex min-w-0 flex-1 flex-col bg-[var(--color-panel)]"
    >
      {children}
    </section>
  );
}

function DetailsTab({ entry, revealed, onToggleReveal }) {
  return (
    <div className="flex flex-col gap-3">
      <FieldRow
        icon={<Icon.User className="size-[18px]" />}
        label="Username"
        actions={
          <CopyButton label="Copy username" getValue={() => copyWithAutoClear(entry.username)} />
        }
      >
        <span className="block truncate">{entry.username || '—'}</span>
      </FieldRow>

      <FieldRow
        icon={<Icon.Lock className="size-[18px]" />}
        label="Password"
        actions={
          <>
            <IconButton
              label={revealed ? 'Hide password' : 'Show password'}
              aria-pressed={revealed}
              onClick={() => onToggleReveal(!revealed)}
            >
              {revealed ? <Icon.EyeOff /> : <Icon.Eye />}
            </IconButton>
            <CopyButton label="Copy password" getValue={() => copyWithAutoClear(entry.password)} />
          </>
        }
      >
        {revealed ? (
          <span className="block break-all font-mono text-sm">{entry.password}</span>
        ) : (
          <span className="block tracking-[0.2em]" aria-label="Password hidden">
            {'•'.repeat(Math.min(entry.password?.length ?? 0, 24)) || '—'}
          </span>
        )}
      </FieldRow>

      {entry.totp !== null && entry.totp !== undefined && (
        <TotpPanel entryId={entry.id} period={entry.totp.period} />
      )}

      {entry.urls?.length > 0 && (
        <FieldRow
          icon={<Icon.Globe className="size-[18px]" />}
          label="Website"
          actions={
            <IconButton label="Open website" onClick={() => window.open(entry.urls[0], '_blank')}>
              <Icon.External />
            </IconButton>
          }
        >
          {/* noreferrer as well as noopener: the target should learn nothing
              about where the click came from. */}
          <a
            href={entry.urls[0]}
            target="_blank"
            rel="noopener noreferrer"
            className="block truncate text-[var(--color-accent)] hover:underline"
          >
            {entry.urls[0]}
          </a>
        </FieldRow>
      )}

      {entry.notes !== '' && entry.notes !== undefined && (
        <FieldRow icon={<Icon.Note className="size-[18px]" />} label="Notes">
          <p className="whitespace-pre-wrap">{entry.notes}</p>
        </FieldRow>
      )}

      <div className="grid grid-cols-2 gap-3">
        <FieldRow icon={<Icon.Calendar className="size-[18px]" />} label="Created">
          <span>{formatDate(entry.createdAt)}</span>
        </FieldRow>
        <FieldRow icon={<Icon.Calendar className="size-[18px]" />} label="Last modified">
          <span>{formatDate(entry.updatedAt)}</span>
        </FieldRow>
      </div>
    </div>
  );
}

function HistoryTab({ entry }) {
  const history = entry.passwordHistory ?? [];

  if (history.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-[var(--color-fg-muted)]">
        No previous passwords recorded for this item.
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-2">
      {history.map((record, index) => (
        <li
          key={`${record.changedAt}-${index}`}
          className="flex items-center gap-3 rounded-[var(--radius-card)] bg-[var(--color-field)] px-4 py-3"
        >
          <Icon.Clock className="size-[18px] shrink-0 text-[var(--color-fg-subtle)]" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-xs text-[var(--color-fg-muted)]">
              Replaced {relativeTime(record.changedAt)}
            </span>
            <span className="truncate font-mono text-sm">{'•'.repeat(12)}</span>
          </div>
          <CopyButton
            label="Copy previous password"
            getValue={() => copyWithAutoClear(record.password)}
          />
        </li>
      ))}
    </ol>
  );
}

/** @param {number} timestamp */
function formatDate(timestamp) {
  if (typeof timestamp !== 'number') {
    return '—';
  }
  return new Date(timestamp).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
