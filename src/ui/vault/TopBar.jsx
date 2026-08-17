import { useEffect, useRef } from 'preact/hooks';
import { IconButton, Icon } from './primitives.jsx';
import { Button } from '../components/Button.jsx';

/**
 * Application header: brand, search, and the global actions.
 */
export function TopBar({ query, onQuery, onNewItem, onLock, theme, onTheme, onSettings }) {
  const searchRef = useRef(null);

  // Cmd/Ctrl-K focuses search. Bound on the window rather than the input so
  // it works wherever focus happens to be.
  useEffect(() => {
    function handleKey(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  return (
    <header className="flex items-center gap-4 border-b border-[var(--color-border)] bg-[var(--color-chrome)] px-5 py-3">
      <div className="flex w-56 shrink-0 items-center gap-2.5">
        <span
          className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-card)] bg-[var(--color-accent)]"
          aria-hidden="true"
        >
          <Icon.Shield className="size-5 text-white" />
        </span>
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-sm font-semibold">KeyVault</span>
          <span className="truncate text-[11px] text-[var(--color-fg-muted)]">
            Local only. Always yours.
          </span>
        </span>
      </div>

      <div className="relative min-w-0 flex-1">
        <label htmlFor="vault-search" className="sr-only">
          Search vault
        </label>
        <Icon.Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-fg-subtle)]" />
        <input
          id="vault-search"
          ref={searchRef}
          type="search"
          value={query}
          placeholder="Search vault…"
          onInput={(e) => onQuery(e.currentTarget.value)}
          className={[
            'h-10 w-full rounded-[var(--radius-field)] pl-9 pr-14 text-sm',
            'bg-[var(--color-field)] text-[var(--color-fg)]',
            'placeholder:text-[var(--color-fg-subtle)]',
            'border border-[var(--color-border)] transition-colors duration-[var(--dur-150)]',
            'hover:border-[var(--color-border-strong)]',
          ].join(' ')}
        />
        <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-fg-subtle)]">
          ⌘K
        </kbd>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Button variant="primary" size="md" onClick={onNewItem}>
          <Icon.Plus className="size-4" />
          New Item
        </Button>

        <Button variant="secondary" size="md" onClick={onLock}>
          <Icon.Lock className="size-4 text-[var(--color-success)]" />
          Lock Vault
        </Button>

        <IconButton
          label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          onClick={onTheme}
        >
          {theme === 'dark' ? <Icon.Sun /> : <Icon.Moon />}
        </IconButton>

        <IconButton label="Settings" onClick={onSettings}>
          <Icon.Settings />
        </IconButton>
      </div>
    </header>
  );
}
