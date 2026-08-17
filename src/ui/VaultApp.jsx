import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { TopBar } from './vault/TopBar.jsx';
import { Sidebar } from './vault/Sidebar.jsx';
import { ItemList } from './vault/ItemList.jsx';
import { ItemDetail } from './vault/ItemDetail.jsx';
import { ItemDrawer } from './vault/ItemDrawer.jsx';
import { Settings } from './vault/Settings.jsx';
import { GeneratorPage } from './vault/GeneratorPage.jsx';
import { TrashView } from './vault/TrashView.jsx';
import { WatchtowerView } from './vault/WatchtowerView.jsx';
import { UpdateBanner } from './vault/UpdateBanner.jsx';
import { RecoveryKit } from './vault/RecoveryKit.jsx';
import { restoreEntryRemote, listTrash } from './lib/messaging.js';
import { Unlock } from './screens/Unlock.jsx';
import { Onboarding } from './screens/Onboarding.jsx';
import { Icon } from './vault/primitives.jsx';
import {
  getStatus,
  listEntries,
  lockVault,
  createEntryRemote,
  updateEntryRemote,
  send,
} from './lib/messaging.js';
import './styles.css';

const VIEW_TITLES = {
  all: 'All Items',
  favorites: 'Favorites',
  recent: 'Recent',
  trash: 'Trash',
  login: 'Logins',
  note: 'Secure Notes',
  card: 'Cards',
  identity: 'Identities',
  document: 'Documents',
};

const CATEGORY_IDS = new Set(['login', 'note', 'card', 'identity', 'document']);

/**
 * The vault application.
 *
 * Rendered by both surfaces so there is one interface rather than two:
 *
 *  - the full page (`vault.html`), opened from the extension's options entry
 *  - the toolbar popup (`popup.html`), which Chrome caps at 800×600
 *
 * `compact` adapts the same layout to that cap — the sidebar becomes an icon
 * rail and the editor overlays the detail pane instead of taking a fourth
 * column. It is a narrower arrangement of the same components, not a second
 * implementation, so the two cannot drift apart.
 *
 * @param {{compact?: boolean}} props
 */
export function VaultApp({ compact = false }) {
  const [status, setStatus] = useState(null);
  const [entries, setEntries] = useState(null);
  const [score, setScore] = useState(null);
  const [view, setView] = useState('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [drawer, setDrawer] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem('keyvault.theme') ?? 'system');
  // At popup width there is no room for a labelled sidebar, so it starts as
  // a rail regardless of the stored preference.
  const [collapsed, setCollapsed] = useState(
    () => compact || localStorage.getItem('keyvault.sidebar') === 'collapsed',
  );
  const [error, setError] = useState(null);
  const [undo, setUndo] = useState(null);

  // The theme override is stored per device rather than in the vault: it must
  // apply on the lock screen, before anything is decrypted.
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', theme);
    }
    localStorage.setItem('keyvault.theme', theme);
  }, [theme]);

  const refreshStatus = useCallback(() => {
    getStatus()
      .then(setStatus)
      .catch((caught) => setError(caught.message));
  }, []);

  const refreshEntries = useCallback(async () => {
    try {
      const { entries: list } = await listEntries();
      setEntries(list);
      const result = await send('security/score').catch(() => null);
      setScore(result);
    } catch (caught) {
      setError(caught.message);
    }
  }, []);

  useEffect(refreshStatus, [refreshStatus]);

  useEffect(() => {
    if (status?.initialized && !status.locked) {
      refreshEntries();
    } else {
      setEntries(null);
      setSelectedId(null);
    }
  }, [status, refreshEntries]);

  const [trashCount, setTrashCount] = useState(0);

  useEffect(() => {
    if (status?.initialized && !status.locked) {
      listTrash()
        .then(({ entries: trashed }) => setTrashCount(trashed.length))
        .catch(() => setTrashCount(0));
    }
  }, [status, entries]);

  const counts = useMemo(() => {
    const list = entries ?? [];
    const recentCutoff = Date.now() - 7 * 86400000;
    const byType = (type) => list.filter((e) => (e.type ?? 'login') === type).length;
    return {
      all: list.length,
      favorites: list.filter((e) => e.favorite).length,
      recent: list.filter((e) => (e.lastUsedAt ?? 0) > recentCutoff).length,
      trash: trashCount,
      login: byType('login'),
      note: byType('note'),
      card: byType('card'),
      identity: byType('identity'),
      document: byType('document'),
    };
  }, [entries, trashCount]);

  const visible = useMemo(() => {
    let list = entries ?? [];

    if (view === 'favorites') list = list.filter((e) => e.favorite);
    else if (view === 'recent') {
      const cutoff = Date.now() - 7 * 86400000;
      list = list.filter((e) => (e.lastUsedAt ?? 0) > cutoff);
    } else if (view === 'trash' || view === 'watchtower' || view === 'recovery') list = [];
    else if (CATEGORY_IDS.has(view)) list = list.filter((e) => (e.type ?? 'login') === view);

    const needle = query.trim().toLowerCase();
    if (needle !== '') {
      list = list.filter((entry) =>
        [entry.title, entry.username, ...(entry.urls ?? []), ...(entry.tags ?? [])]
          .join('\n')
          .toLowerCase()
          .includes(needle),
      );
    }
    return list;
  }, [entries, view, query]);

  async function handleSave(values) {
    const fields = {
      title: values.title.trim(),
      username: values.username.trim(),
      password: values.password,
      urls: values.url.trim() === '' ? [] : [values.url.trim()],
      notes: values.notes,
      autoSubmit: values.autoSubmit === true,
      type: values.type ?? 'login',
      totpUri: values.totpUri.trim() === '' ? undefined : values.totpUri.trim(),
    };

    if (drawer?.entry != null) {
      await updateEntryRemote(drawer.entry.id, fields);
    } else {
      const created = await createEntryRemote(fields);
      setSelectedId(created.entry.id);
    }
    setDrawer(null);
    await refreshEntries();
  }

  async function handleToggleFavorite(id) {
    const entry = (entries ?? []).find((e) => e.id === id);
    await updateEntryRemote(id, { favorite: !entry?.favorite });
    await refreshEntries();
  }

  if (error !== null) {
    return <FullScreenMessage tone="danger">{error}</FullScreenMessage>;
  }
  if (status === null) {
    return <div className="h-dvh" aria-busy="true" />;
  }
  if (!status.initialized) {
    return (
      <Centered>
        <Onboarding onCreated={refreshStatus} />
      </Centered>
    );
  }
  if (status.locked) {
    return (
      <Centered>
        <Unlock onUnlocked={refreshStatus} />
      </Centered>
    );
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      {/* Above the top bar, and only ever rendered when there is genuinely a
          newer release: a status strip that is usually present is one nobody
          reads by the time it matters. */}
      <UpdateBanner />

      <TopBar
        compact={compact}
        query={query}
        onQuery={setQuery}
        onNewItem={() => setDrawer({ entry: null })}
        onLock={async () => {
          await lockVault();
          refreshStatus();
        }}
        theme={theme === 'system' ? preferredTheme() : theme}
        onTheme={() => setTheme(currentIsDark() ? 'light' : 'dark')}
        onSettings={() => {
          setView(view === 'settings' ? 'all' : 'settings');
          setSelectedId(null);
        }}
      />

      <div className="flex min-h-0 flex-1">
        <Sidebar
          view={view}
          onSelectView={(next) => {
            setView(next);
            setSelectedId(null);
          }}
          counts={counts}
          score={score}
          onOpenScore={() => {
            setView('watchtower');
            setSelectedId(null);
          }}
          collapsed={collapsed}
          onToggle={() => {
            setCollapsed((current) => {
              localStorage.setItem('keyvault.sidebar', current ? 'expanded' : 'collapsed');
              return !current;
            });
          }}
        />

        {view === 'settings' ? (
          <Settings onChanged={refreshEntries} />
        ) : view === 'generator' ? (
          <GeneratorPage />
        ) : view === 'trash' ? (
          <TrashView onChanged={refreshEntries} />
        ) : view === 'recovery' ? (
          <RecoveryKit />
        ) : view === 'watchtower' ? (
          <WatchtowerView
            score={score}
            entries={entries}
            onOpenEntry={(id) => {
              // Land on the item itself rather than merely filtering to it:
              // the point of the list is to fix the thing, and the fix is in
              // the detail pane.
              setView('all');
              setSelectedId(id);
            }}
            onOpenSettings={() => {
              setView('settings');
              setSelectedId(null);
            }}
          />
        ) : (
          <>
            <ItemList
              compact={compact}
              title={VIEW_TITLES[view] ?? 'Items'}
              entries={visible}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onToggleFavorite={handleToggleFavorite}
              loading={entries === null}
            />

            {/* At popup width the editor replaces the detail pane rather
                than adding a fourth column, which would leave nothing
                legible. */}
            {compact && drawer !== null ? null : selectedId === null ? (
              <NoSelection compact={compact} />
            ) : (
              <ItemDetail
                compact={compact}
                entryId={selectedId}
                onEdit={(entry) => setDrawer({ entry })}
                onChanged={(result) => {
                  // An undo offered right where the action happened. The
                  // trash is the safety net; this is the one people use.
                  if (result?.trashed !== undefined) {
                    setUndo(result.trashed);
                  }
                  refreshEntries();
                }}
                onClose={() => setSelectedId(null)}
              />
            )}
          </>
        )}

        {undo !== null && (
          <UndoToast
            entry={undo}
            onUndo={async () => {
              await restoreEntryRemote(undo.id);
              setSelectedId(undo.id);
              setUndo(null);
              refreshEntries();
            }}
            onDismiss={() => setUndo(null)}
          />
        )}

        {drawer !== null && (
          <ItemDrawer
            compact={compact}
            entry={drawer.entry}
            onSave={handleSave}
            onClose={() => setDrawer(null)}
          />
        )}
      </div>
    </div>
  );
}

/**
 * A short-lived offer to undo the last deletion.
 *
 * Dismisses itself after ten seconds. The item is still in the trash after
 * that — this only saves the trip there, which is what makes deleting feel
 * safe enough to do without a confirmation dialog.
 */
function UndoToast({ entry, onUndo, onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 10000);
    return () => clearTimeout(timer);
  }, [entry, onDismiss]);

  return (
    <div
      role="status"
      className={[
        'fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-4',
        'rounded-[var(--radius-card)] border border-[var(--color-border)]',
        'bg-[var(--color-panel)] py-3 pl-4 pr-3 shadow-xl',
      ].join(' ')}
    >
      <span className="text-sm">
        Moved <strong className="font-semibold">{entry.title}</strong> to the trash
      </span>
      <button
        type="button"
        onClick={onUndo}
        className="rounded-[var(--radius-field)] px-2 py-1 text-sm font-semibold text-[var(--color-accent)] transition-colors duration-[var(--dur-150)] hover:bg-[var(--color-surface-hover)]"
      >
        Undo
      </button>
    </div>
  );
}

function preferredTheme() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function currentIsDark() {
  const override = document.documentElement.getAttribute('data-theme');
  return override === null ? preferredTheme() === 'dark' : override === 'dark';
}

function Centered({ children }) {
  return (
    <div className="grid h-dvh place-items-center p-4">
      <div className="w-[380px] rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-panel)] shadow-xl">
        {children}
      </div>
    </div>
  );
}

function NoSelection({ compact }) {
  if (compact) {
    // A large empty pane is worse than none at popup width.
    return null;
  }
  return (
    <section
      aria-label="No item selected"
      className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-[var(--color-panel)] text-center"
    >
      <div className="grid size-14 place-items-center rounded-full bg-[var(--color-accent)]/10">
        <Icon.Lock className="size-6 text-[var(--color-accent)]" />
      </div>
      <h2 className="text-base font-semibold">Select an item</h2>
      <p className="max-w-[34ch] text-sm text-[var(--color-fg-muted)]">
        Pick something from the list to see its details, or create a new item.
      </p>
    </section>
  );
}

function FullScreenMessage({ tone, children }) {
  return (
    <div className="grid h-dvh place-items-center p-8">
      <p
        role="alert"
        className={`max-w-md text-center text-sm ${
          tone === 'danger' ? 'text-[var(--color-danger)]' : 'text-[var(--color-fg-muted)]'
        }`}
      >
        {children}
      </p>
    </div>
  );
}
