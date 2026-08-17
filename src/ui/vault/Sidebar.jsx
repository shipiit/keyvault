import { Icon } from './primitives.jsx';
import { describeIssues } from '../../core/security-score.js';

/**
 * Left navigation: views, categories, and the security score.
 *
 * The score is computed from the vault's real contents, not a fixed number —
 * see `core/security-score.js`. Every point it deducts corresponds to an
 * entry the user can open and fix.
 */

const VIEWS = [
  { id: 'all', label: 'All Items', icon: Icon.Grid },
  // A tool rather than a collection, so it carries no count and is always
  // shown — hiding it when empty would hide it permanently.
  { id: 'generator', label: 'Generator', icon: Icon.Refresh, tool: true },
  { id: 'watchtower', label: 'Watchtower', icon: Icon.Shield, tool: true },
  { id: 'recovery', label: 'Recovery kit', icon: Icon.Document, tool: true },
  { id: 'favorites', label: 'Favorites', icon: Icon.Star },
  { id: 'recent', label: 'Recent', icon: Icon.Clock },
  { id: 'trash', label: 'Trash', icon: Icon.Trash },
];

const CATEGORIES = [
  { id: 'login', label: 'Logins', icon: Icon.Lock },
  { id: 'note', label: 'Secure Notes', icon: Icon.Note },
  { id: 'card', label: 'Cards', icon: Icon.Card },
  { id: 'identity', label: 'Identities', icon: Icon.Identity },
  { id: 'document', label: 'Documents', icon: Icon.Document },
];

/**
 * Which rows to show.
 *
 * Empty rows are hidden. A column of zeroes is noise that pushes the useful
 * entries down and makes the vault look broken on first run. A category
 * reappears the moment it has something in it, so nothing is permanently
 * lost — and the New Item drawer still offers every type regardless.
 *
 * Two exceptions, both deliberate:
 *  - "All Items" always shows, so there is never an empty sidebar.
 *  - The currently selected row always shows, so the view you are looking at
 *    cannot vanish from under you when you delete its last item.
 *
 * @param {object[]} items
 * @param {object} counts
 * @param {string} view
 */
function visibleRows(items, counts, view) {
  return items.filter(
    (item) =>
      item.id === 'all' || item.tool === true || item.id === view || (counts[item.id] ?? 0) > 0,
  );
}

export function Sidebar({ view, onSelectView, counts, score, onOpenScore, collapsed, onToggle }) {
  const views = visibleRows(VIEWS, counts, view);
  const categories = visibleRows(CATEGORIES, counts, view);

  return (
    <nav
      aria-label="Vault navigation"
      className={[
        'flex shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-chrome)]',
        'transition-[width] duration-[var(--dur-200)] ease-[var(--ease-out-quint)]',
        collapsed ? 'w-[60px]' : 'w-60',
      ].join(' ')}
    >
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-4">
        <Group title="Main menu" collapsed={collapsed}>
          {views.map((item) => (
            <NavItem
              key={item.id}
              item={item}
              count={counts[item.id] ?? 0}
              active={view === item.id}
              collapsed={collapsed}
              onSelect={onSelectView}
            />
          ))}
        </Group>

        {categories.length > 0 && (
          <Group title="Categories" collapsed={collapsed}>
            {categories.map((item) => (
              <NavItem
                key={item.id}
                item={item}
                count={counts[item.id] ?? 0}
                active={view === item.id}
                collapsed={collapsed}
                onSelect={onSelectView}
              />
            ))}
          </Group>
        )}
      </div>

      {!collapsed && (
        <div className="px-3 pb-3">
          <SecurityScoreCard score={score} onOpen={onOpenScore} />
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-[var(--color-border)] px-3 py-2">
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-field)] text-[var(--color-fg-muted)] transition-colors duration-[var(--dur-150)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-fg)] active:translate-y-px"
        >
          <Icon.Chevron className={`size-4 ${collapsed ? '-rotate-90' : 'rotate-90'}`} />
        </button>
        {!collapsed && <StorageNote />}
      </div>
    </nav>
  );
}

function Group({ title, collapsed, children }) {
  return (
    <div className="mb-5">
      <h2
        className={[
          'px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider',
          'text-[var(--color-fg-subtle)]',
          collapsed ? 'sr-only' : '',
        ].join(' ')}
      >
        {title}
      </h2>
      <ul className="flex flex-col gap-0.5">{children}</ul>
    </div>
  );
}

function NavItem({ item, count, active, collapsed, onSelect }) {
  const IconComponent = item.icon;
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(item.id)}
        aria-current={active ? 'page' : undefined}
        // The label is the accessible name when collapsed, and the title
        // gives a sighted user the same information on hover.
        aria-label={collapsed ? `${item.label}, ${count} items` : undefined}
        title={collapsed ? `${item.label} (${count})` : undefined}
        className={[
          'flex w-full items-center gap-3 rounded-[var(--radius-field)] py-2 text-sm',
          'transition-colors duration-[var(--dur-150)] active:translate-y-px',
          collapsed ? 'justify-center px-0' : 'px-3',
          active
            ? 'bg-[var(--color-accent)]/15 font-medium text-[var(--color-accent)]'
            : 'text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-fg)]',
        ].join(' ')}
      >
        <span className="relative shrink-0">
          <IconComponent className="size-[18px]" />
          {collapsed && count > 0 && (
            <span className="tabular absolute -right-2 -top-1.5 rounded-full bg-[var(--color-accent)] px-1 text-[9px] font-bold text-white">
              {count}
            </span>
          )}
        </span>
        {!collapsed && (
          <>
            <span className="flex-1 truncate text-left">{item.label}</span>
            {item.tool !== true && (
              <span className="tabular shrink-0 text-xs text-[var(--color-fg-subtle)]">
                {count}
              </span>
            )}
          </>
        )}
      </button>
    </li>
  );
}

function SecurityScoreCard({ score, onOpen }) {
  if (score === null) {
    return null;
  }

  const tone =
    score.score >= 90
      ? 'var(--color-success)'
      : score.score >= 75
        ? 'var(--color-accent)'
        : score.score >= 50
          ? 'var(--color-warn)'
          : 'var(--color-danger)';

  const issues = describeIssues(score.counts);
  const summary =
    issues.length === 0
      ? score.checked === 0
        ? 'No passwords saved yet'
        : 'No problems found'
      : issues[0].text;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={[
        'flex w-full flex-col gap-2 rounded-[var(--radius-card)] p-3 text-left',
        'border border-[var(--color-border)] bg-[var(--color-panel)]',
        'transition-colors duration-[var(--dur-150)] hover:border-[var(--color-border-strong)]',
      ].join(' ')}
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">
          Security score
        </span>
        <span className="tabular text-sm font-bold" style={{ color: tone }}>
          {score.score}%
        </span>
      </span>

      {/* A bar reads as a proportion at a glance, where a ring has to be
          decoded. It also degrades gracefully at any sidebar width. */}
      <span
        role="progressbar"
        aria-valuenow={score.score}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-label={`Security score ${score.score} out of 100, ${score.label}`}
        className="block h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-border)]"
      >
        <span
          className="block h-full rounded-full transition-[width] duration-[var(--dur-200)] ease-[var(--ease-out-quint)]"
          style={{ width: `${score.score}%`, backgroundColor: tone }}
        />
      </span>

      <span className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 flex-col">
          <span className="text-xs font-semibold" style={{ color: tone }}>
            {score.label}
          </span>
          <span className="truncate text-[11px] text-[var(--color-fg-muted)]">{summary}</span>
          {/* Saying nothing here would let the score read as a full check
              when breach data was never fetched. */}
          {!score.breachDataAvailable && score.checked > 0 && (
            <span className="truncate text-[11px] text-[var(--color-fg-subtle)]">
              Breach check off
            </span>
          )}
        </span>
        <Icon.Chevron className="size-4 shrink-0 -rotate-90 text-[var(--color-fg-subtle)]" />
      </span>
    </button>
  );
}

/**
 * Replaces the "Last synced" line a cloud manager would show.
 *
 * KeyVault has no sync and no server, so a sync status would be a claim about
 * something that does not exist. Stating the actual guarantee is both honest
 * and more reassuring.
 */
function StorageNote() {
  return (
    <p className="flex items-center gap-2 border-t border-[var(--color-border)] px-5 py-3 text-xs text-[var(--color-fg-muted)]">
      <span
        className="size-1.5 shrink-0 rounded-full bg-[var(--color-success)]"
        aria-hidden="true"
      />
      Stored on this device only
    </p>
  );
}
