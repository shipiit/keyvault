import { useState } from 'preact/hooks';
import { ItemAvatar, Pill, IconButton, Icon } from './primitives.jsx';
import { TotpCode } from '../components/TotpCode.jsx';

/**
 * Middle column: the item list for the selected view.
 *
 * Rows carry metadata only. No password is fetched to render a list — that
 * happens when the user asks for one, in the detail pane.
 */

const SORTS = [
  { id: 'updated', label: 'Last Modified' },
  { id: 'title', label: 'Title' },
  { id: 'used', label: 'Recently Used' },
];

export function ItemList({
  title,
  entries,
  selectedId,
  onSelect,
  onToggleFavorite,
  loading,
  compact = false,
}) {
  const [sort, setSort] = useState('updated');
  const [dense, setDense] = useState(false);

  const sorted = [...entries].sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title);
    if (sort === 'used') return (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0);
    return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  });

  return (
    <section
      aria-label={title}
      className={[
        'flex shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-bg)]',
        compact ? 'w-[270px]' : 'w-[340px]',
      ].join(' ')}
    >
      <header className={compact ? 'px-4 pb-2 pt-3' : 'px-5 pb-3 pt-5'}>
        <h1
          className={compact ? 'text-base font-semibold' : 'text-xl font-semibold tracking-tight'}
        >
          {title}
        </h1>
      </header>

      <div
        className={`flex items-center justify-between gap-2 pb-2 ${compact ? 'px-4' : 'px-5 pb-3'}`}
      >
        <label className="flex items-center gap-1.5 text-xs text-[var(--color-fg-muted)]">
          <Icon.Sort className="size-4" />
          <span className="sr-only">Sort by</span>
          Sort by:
          <select
            value={sort}
            onChange={(e) => setSort(e.currentTarget.value)}
            className="cursor-pointer rounded bg-transparent py-0.5 pr-1 font-medium text-[var(--color-fg)] hover:text-[var(--color-accent)]"
          >
            {SORTS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <IconButton
          label={dense ? 'Show detailed rows' : 'Show compact rows'}
          aria-pressed={dense}
          onClick={() => setDense((current) => !current)}
          className="size-8"
        >
          {dense ? <Icon.Grid /> : <Icon.List />}
        </IconButton>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {loading && <SkeletonRows />}
        {!loading && sorted.length === 0 && <EmptyState />}
        {!loading && sorted.length > 0 && (
          <ul className="flex flex-col gap-1">
            {sorted.map((entry) => (
              <ItemRow
                key={entry.id}
                entry={entry}
                dense={dense}
                selected={entry.id === selectedId}
                onSelect={onSelect}
                onToggleFavorite={onToggleFavorite}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function ItemRow({ entry, dense, selected, onSelect, onToggleFavorite }) {
  return (
    <li>
      <div
        className={[
          'group relative flex items-start gap-3 rounded-[var(--radius-card)] px-3 py-2.5',
          'border transition-colors duration-[var(--dur-150)]',
          selected
            ? 'border-[var(--color-selected-border)] bg-[var(--color-selected)]'
            : 'border-transparent hover:border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]',
        ].join(' ')}
      >
        {/* The whole row is the target, but it stays a real button so it is
            reachable and announced correctly rather than a clickable div. */}
        <button
          type="button"
          onClick={() => onSelect(entry.id)}
          aria-current={selected ? 'true' : undefined}
          className="absolute inset-0 rounded-[var(--radius-card)]"
        >
          <span className="sr-only">{`Open ${entry.title}`}</span>
        </button>

        <ItemAvatar title={entry.title} size={dense ? 'sm' : 'md'} />

        <div className="pointer-events-none relative flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{entry.title}</span>
            {entry.favorite && <Pill>Favorite</Pill>}
          </div>
          <span className="truncate text-xs text-[var(--color-fg-muted)]">
            {entry.username || 'No username'}
          </span>

          {entry.hasTotp && !dense && (
            <div className="pointer-events-auto mt-1">
              <TotpCode entryId={entry.id} />
            </div>
          )}

          {!dense && entry.updatedAt != null && (
            <span className="mt-1 text-[11px] text-[var(--color-fg-subtle)]">
              Updated {relativeTime(entry.updatedAt)}
            </span>
          )}
        </div>

        <div className="relative flex shrink-0 items-center gap-0.5">
          <IconButton
            label={entry.favorite ? 'Remove from favorites' : 'Add to favorites'}
            aria-pressed={entry.favorite === true}
            onClick={() => onToggleFavorite(entry.id)}
            className={[
              'size-8',
              entry.favorite
                ? 'text-[var(--color-warn)] opacity-100'
                : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
            ].join(' ')}
          >
            <Icon.Star filled={entry.favorite === true} />
          </IconButton>
        </div>
      </div>
    </li>
  );
}

/** @param {number} timestamp */
export function relativeTime(timestamp) {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  const units = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];

  if (seconds < 60) {
    return 'just now';
  }
  for (const [unit, size] of units) {
    if (seconds >= size) {
      const value = Math.floor(seconds / size);
      return `${value} ${unit}${value === 1 ? '' : 's'} ago`;
    }
  }
  return 'just now';
}

function SkeletonRows() {
  return (
    <ul className="flex flex-col gap-1" aria-label="Loading items">
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="flex items-center gap-3 px-3 py-3">
          <div className="size-10 shrink-0 animate-pulse rounded-[var(--radius-card)] bg-[var(--color-surface-hover)]" />
          <div className="flex flex-1 flex-col gap-2">
            <div className="h-3 w-2/5 animate-pulse rounded bg-[var(--color-surface-hover)]" />
            <div className="h-2.5 w-3/5 animate-pulse rounded bg-[var(--color-surface-hover)]" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
      <div className="grid size-11 place-items-center rounded-full bg-[var(--color-accent)]/10">
        <Icon.Lock className="size-5 text-[var(--color-accent)]" />
      </div>
      <h2 className="text-sm font-semibold">Nothing here</h2>
      <p className="max-w-[28ch] text-xs text-[var(--color-fg-muted)]">
        Log in to a site and KeyVault will offer to save the password, or add an item yourself.
      </p>
    </div>
  );
}
