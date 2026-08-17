import { useEffect, useState } from 'preact/hooks';
import { ItemAvatar, Icon } from './primitives.jsx';
import { Button } from '../components/Button.jsx';
import { listTrash, restoreEntryRemote, purgeEntryRemote, emptyTrash } from '../lib/messaging.js';
import { relativeTime } from './ItemList.jsx';

/**
 * The trash.
 *
 * Nothing here is deleted on a timer. Every other product empties its trash
 * after thirty days, which is fine when a server holds a copy — here it
 * would be an automatic, silent, unrecoverable loss. So it fills up until
 * the user decides otherwise, and says how many it is holding.
 */
export function TrashView({ onChanged }) {
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const { entries: trashed } = await listTrash();
      setEntries(trashed);
    } catch (caught) {
      setError(caught.message);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function restore(id) {
    setBusy(true);
    await restoreEntryRemote(id);
    await refresh();
    onChanged?.();
    setBusy(false);
  }

  async function purge(entry) {
    // This one does confirm, and names the item. It is the only action in
    // KeyVault that destroys something with no way back.
    const confirmed = window.confirm(
      `Delete “${entry.title}” for good?\n\n` +
        'This cannot be undone. No server holds a copy of your vault.',
    );
    if (!confirmed) {
      return;
    }
    setBusy(true);
    await purgeEntryRemote(entry.id);
    await refresh();
    onChanged?.();
    setBusy(false);
  }

  async function empty() {
    const confirmed = window.confirm(
      `Delete all ${entries.length} items in the trash for good?\n\n` +
        'This cannot be undone. No server holds a copy of your vault.',
    );
    if (!confirmed) {
      return;
    }
    setBusy(true);
    await emptyTrash();
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
            <Icon.Trash className="size-5 text-[var(--color-accent)]" />
          </div>
          <h2 className="text-sm font-semibold">The trash is empty</h2>
          <p className="max-w-[36ch] text-xs leading-relaxed text-[var(--color-fg-muted)]">
            Deleted items wait here until you remove them. Nothing is cleared automatically — there
            is no copy of your vault anywhere else.
          </p>
        </div>
      </Pane>
    );
  }

  return (
    <Pane>
      <div className="mb-4 flex items-start justify-between gap-4">
        <p className="max-w-[52ch] text-sm leading-relaxed text-[var(--color-fg-muted)]">
          {entries === null
            ? 'Loading…'
            : `${entries.length} ${entries.length === 1 ? 'item' : 'items'} waiting. Restoring puts one back exactly as it was. Nothing here is removed on a timer.`}
        </p>
        {entries !== null && entries.length > 0 && (
          <Button variant="danger" size="sm" disabled={busy} onClick={empty}>
            Empty trash
          </Button>
        )}
      </div>

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
                {entry.username || 'No username'} · deleted {relativeTime(entry.deletedAt)}
              </span>
            </div>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => restore(entry.id)}>
              Restore
            </Button>
            <Button variant="danger" size="sm" disabled={busy} onClick={() => purge(entry)}>
              Delete
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
      aria-label="Trash"
      className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-[var(--color-panel)] px-8 py-6"
    >
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Trash</h1>
      {children}
    </section>
  );
}
