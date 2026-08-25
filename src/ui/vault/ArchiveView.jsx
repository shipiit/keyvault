import { useEffect, useState } from 'preact/hooks';
import { ItemAvatar, Icon } from './primitives.jsx';
import { Button } from '../components/Button.jsx';
import { listArchive, unarchiveEntryRemote } from '../lib/messaging.js';
import { relativeTime } from './ItemList.jsx';

/**
 * The archive.
 *
 * Not the trash, and the difference is the reason both exist. Trash means "I
 * deleted this and might undo it". Archive means "I am keeping this
 * deliberately, and it is not current" — a closed bank account, a job you
 * left, a service you cancelled. You want the record; you do not want it
 * suggested at a login form ever again.
 *
 * Nothing here expires. Every other product sweeps an archive eventually,
 * which is fine when a server holds a copy — here it would be silent,
 * permanent loss.
 */
export function ArchiveView({ onChanged }) {
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const { entries: archived } = await listArchive();
      setEntries(archived);
    } catch (caught) {
      setError(caught.message);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function restore(id) {
    setBusy(true);
    await unarchiveEntryRemote(id);
    await refresh();
    onChanged?.();
    setBusy(false);
  }

  if (error !== null) {
    return (
      <Pane>
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {error}
        </p>
      </Pane>
    );
  }

  if (entries !== null && entries.length === 0) {
    return (
      <Pane>
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <div className="grid size-11 place-items-center rounded-full bg-[var(--color-accent)]/10">
            <Icon.Box className="size-5 text-[var(--color-accent)]" />
          </div>
          <h2 className="text-sm font-semibold">Nothing archived</h2>
          <p className="max-w-[40ch] text-xs leading-relaxed text-[var(--color-fg-muted)]">
            Archiving keeps an item without offering it to a login form — for accounts you have
            closed but want a record of. Unlike the trash, nothing here is ever removed.
          </p>
        </div>
      </Pane>
    );
  }

  return (
    <Pane>
      <p className="mb-4 max-w-[56ch] text-sm leading-relaxed text-[var(--color-fg-muted)]">
        {entries === null
          ? 'Loading…'
          : `${entries.length} ${entries.length === 1 ? 'item' : 'items'} kept out of circulation. They are excluded from search, autofill and your security score, and nothing here expires.`}
      </p>

      <ul className="flex flex-col gap-1">
        {(entries ?? []).map((entry) => (
          <li
            key={entry.id}
            className="flex items-center gap-3 rounded-[var(--radius-card)] border border-[var(--color-border)] px-4 py-3"
          >
            <ItemAvatar title={entry.title} size="sm" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">{entry.title}</span>
              <span className="truncate text-xs text-[var(--color-fg-muted)]">
                {entry.username || 'No username'} · archived {relativeTime(entry.archivedAt)}
              </span>
            </div>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => restore(entry.id)}>
              Restore
            </Button>
          </li>
        ))}
      </ul>
    </Pane>
  );
}

function Pane({ children }) {
  return (
    <section
      aria-label="Archive"
      className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-[var(--color-panel)] px-8 py-6"
    >
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Archive</h1>
      {children}
    </section>
  );
}
