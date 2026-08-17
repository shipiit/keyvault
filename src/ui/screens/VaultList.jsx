import { useEffect, useMemo, useState } from 'preact/hooks';
import { EntryRow } from '../components/EntryRow.jsx';
import { Button } from '../components/Button.jsx';
import { listEntries, lockVault, getActiveTabUrl } from '../lib/messaging.js';
import { entriesForUrl } from '../../core/url-match.js';

/**
 * The main popup surface: search, credentials for the current site first,
 * then everything else.
 *
 * Only summaries are held here — no passwords, no TOTP secrets. Those are
 * fetched from the background at the moment they are used.
 */
export function VaultList({ onLocked }) {
  const [entries, setEntries] = useState(null);
  const [query, setQuery] = useState('');
  const [tabUrl, setTabUrl] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    Promise.all([listEntries(), getActiveTabUrl()])
      .then(([{ entries: list }, url]) => {
        if (active) {
          setEntries(list);
          setTabUrl(url);
        }
      })
      .catch((caught) => active && setError(caught.message));
    return () => {
      active = false;
    };
  }, []);

  const { matching, others } = useMemo(() => {
    if (entries === null) return { matching: [], others: [] };

    const needle = query.trim().toLowerCase();
    const visible =
      needle === ''
        ? entries
        : entries.filter((e) =>
            [e.title, e.username, ...e.urls, ...e.tags].join('\n').toLowerCase().includes(needle),
          );

    if (tabUrl === null) return { matching: [], others: visible };

    const matchIds = new Set(entriesForUrl(visible, tabUrl).map((e) => e.id));
    return {
      matching: visible.filter((e) => matchIds.has(e.id)),
      others: visible.filter((e) => !matchIds.has(e.id)),
    };
  }, [entries, query, tabUrl]);

  async function handleLock() {
    await lockVault();
    onLocked();
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-[var(--color-border)] p-3">
        <SearchInput value={query} onInput={setQuery} />
        <Button variant="ghost" size="sm" onClick={handleLock} aria-label="Lock vault">
          Lock
        </Button>
      </header>

      <main className="flex-1 overflow-y-auto p-2">
        {error !== null && <ErrorState message={error} />}
        {error === null && entries === null && <LoadingState />}
        {error === null && entries !== null && (
          <EntryGroups matching={matching} others={others} query={query} total={entries.length} />
        )}
      </main>
    </div>
  );
}

function EntryGroups({ matching, others, query, total }) {
  if (total === 0) return <EmptyState />;
  if (matching.length === 0 && others.length === 0) return <NoResults query={query} />;

  return (
    <>
      {matching.length > 0 && (
        <section aria-labelledby="for-this-site">
          <GroupHeading id="for-this-site">For this site</GroupHeading>
          <ul className="mb-3 flex flex-col gap-0.5">
            {matching.map((entry) => (
              <EntryRow key={entry.id} entry={entry} matchesCurrentSite />
            ))}
          </ul>
        </section>
      )}
      {others.length > 0 && (
        <section aria-labelledby="all-items">
          {matching.length > 0 && <GroupHeading id="all-items">All items</GroupHeading>}
          <ul className="flex flex-col gap-0.5">
            {others.map((entry) => (
              <EntryRow key={entry.id} entry={entry} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function GroupHeading({ id, children }) {
  return (
    <h2
      id={id}
      className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]"
    >
      {children}
    </h2>
  );
}

function SearchInput({ value, onInput }) {
  return (
    <div className="relative flex-1">
      <label htmlFor="vault-search" className="sr-only">
        Search credentials
      </label>
      <input
        id="vault-search"
        type="search"
        value={value}
        autoFocus
        placeholder="Search…"
        onInput={(e) => onInput(e.currentTarget.value)}
        className={[
          'h-9 w-full rounded-[var(--radius-field)] pl-8 pr-3 text-sm',
          'bg-[var(--color-bg)] text-[var(--color-fg)]',
          'placeholder:text-[var(--color-fg-subtle)]',
          'border border-[var(--color-border)] transition-colors duration-[var(--dur-150)]',
          'hover:border-[var(--color-border-strong)]',
        ].join(' ')}
      />
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-[var(--color-fg-subtle)]"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="9" cy="9" r="5.5" />
        <path d="M13 13l4 4" />
      </svg>
    </div>
  );
}

function LoadingState() {
  return (
    <ul className="flex flex-col gap-0.5" aria-label="Loading credentials">
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex items-center gap-3 px-3 py-2.5">
          <div className="size-8 shrink-0 animate-pulse rounded-[var(--radius-field)] bg-[var(--color-surface-hover)]" />
          <div className="flex flex-1 flex-col gap-1.5">
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
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <div className="grid size-11 place-items-center rounded-full bg-[var(--color-accent)]/10">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="1.7"
          strokeLinecap="round"
          className="size-5"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </div>
      <h2 className="text-sm font-semibold">No credentials yet</h2>
      <p className="max-w-[30ch] text-xs text-[var(--color-fg-muted)]">
        Log in to a site and KeyVault will offer to save the password for you.
      </p>
    </div>
  );
}

function NoResults({ query }) {
  return (
    <p className="px-6 py-10 text-center text-sm text-[var(--color-fg-muted)]">
      Nothing matches “{query}”.
    </p>
  );
}

function ErrorState({ message }) {
  return (
    <p role="alert" className="px-6 py-10 text-center text-sm text-[var(--color-danger)]">
      {message}
    </p>
  );
}
