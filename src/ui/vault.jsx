import { render } from 'preact';
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { TopBar } from './vault/TopBar.jsx';
import { Sidebar } from './vault/Sidebar.jsx';
import { ItemList } from './vault/ItemList.jsx';
import { ItemDetail } from './vault/ItemDetail.jsx';
import { ItemDrawer } from './vault/ItemDrawer.jsx';
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

/** Only logins exist so far; the other categories are always empty. */
const IMPLEMENTED_CATEGORIES = new Set(['login']);

function App() {
  const [status, setStatus] = useState(null);
  const [entries, setEntries] = useState(null);
  const [score, setScore] = useState(null);
  const [view, setView] = useState('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [drawer, setDrawer] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem('keyvault.theme') ?? 'system');
  const [error, setError] = useState(null);

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

  const counts = useMemo(() => {
    const list = entries ?? [];
    const recentCutoff = Date.now() - 7 * 86400000;
    return {
      all: list.length,
      favorites: list.filter((e) => e.favorite).length,
      recent: list.filter((e) => (e.lastUsedAt ?? 0) > recentCutoff).length,
      trash: 0,
      login: list.length,
      note: 0,
      card: 0,
      identity: 0,
      document: 0,
    };
  }, [entries]);

  const visible = useMemo(() => {
    let list = entries ?? [];

    if (view === 'favorites') list = list.filter((e) => e.favorite);
    else if (view === 'recent') {
      const cutoff = Date.now() - 7 * 86400000;
      list = list.filter((e) => (e.lastUsedAt ?? 0) > cutoff);
    } else if (view === 'trash') list = [];
    else if (!IMPLEMENTED_CATEGORIES.has(view) && view !== 'all') list = [];

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
      <TopBar
        query={query}
        onQuery={setQuery}
        onNewItem={() => setDrawer({ entry: null })}
        onLock={async () => {
          await lockVault();
          refreshStatus();
        }}
        theme={theme === 'system' ? preferredTheme() : theme}
        onTheme={() => setTheme(currentIsDark() ? 'light' : 'dark')}
        onSettings={() => setView('settings')}
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
          onOpenScore={() => setView('all')}
        />

        <ItemList
          title={VIEW_TITLES[view] ?? 'Items'}
          entries={visible}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onToggleFavorite={handleToggleFavorite}
          loading={entries === null}
        />

        {selectedId === null ? (
          <NoSelection />
        ) : (
          <ItemDetail
            entryId={selectedId}
            onEdit={(entry) => setDrawer({ entry })}
            onClose={() => setSelectedId(null)}
          />
        )}

        {drawer !== null && (
          <ItemDrawer entry={drawer.entry} onSave={handleSave} onClose={() => setDrawer(null)} />
        )}
      </div>
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
    <div className="grid h-dvh place-items-center">
      <div className="w-[380px] rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-panel)] shadow-xl">
        {children}
      </div>
    </div>
  );
}

function NoSelection() {
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

render(<App />, document.getElementById('root'));
