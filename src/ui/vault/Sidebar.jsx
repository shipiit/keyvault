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

export function Sidebar({ view, onSelectView, counts, score, onOpenScore }) {
  return (
    <nav
      aria-label="Vault navigation"
      className="flex w-60 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-chrome)]"
    >
      <div className="flex-1 overflow-y-auto px-3 py-4">
        <Group title="Main menu">
          {VIEWS.map((item) => (
            <NavItem
              key={item.id}
              item={item}
              count={counts[item.id] ?? 0}
              active={view === item.id}
              onSelect={onSelectView}
            />
          ))}
        </Group>

        <Group title="Categories">
          {CATEGORIES.map((item) => (
            <NavItem
              key={item.id}
              item={item}
              count={counts[item.id] ?? 0}
              active={view === item.id}
              onSelect={onSelectView}
            />
          ))}
        </Group>
      </div>

      <div className="px-3 pb-3">
        <SecurityScoreCard score={score} onOpen={onOpenScore} />
      </div>

      <StorageNote />
    </nav>
  );
}

function Group({ title, children }) {
  return (
    <div className="mb-5">
      <h2 className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">
        {title}
      </h2>
      <ul className="flex flex-col gap-0.5">{children}</ul>
    </div>
  );
}

function NavItem({ item, count, active, onSelect }) {
  const IconComponent = item.icon;
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(item.id)}
        aria-current={active ? 'page' : undefined}
        className={[
          'flex w-full items-center gap-3 rounded-[var(--radius-field)] px-3 py-2 text-sm',
          'transition-colors duration-[var(--dur-150)] active:translate-y-px',
          active
            ? 'bg-[var(--color-accent)]/15 font-medium text-[var(--color-accent)]'
            : 'text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-fg)]',
        ].join(' ')}
      >
        <IconComponent className="size-[18px] shrink-0" />
        <span className="flex-1 truncate text-left">{item.label}</span>
        <span className="tabular shrink-0 text-xs text-[var(--color-fg-subtle)]">{count}</span>
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
        'flex w-full items-center gap-3 rounded-[var(--radius-card)] p-3 text-left',
        'border border-[var(--color-border)] bg-[var(--color-panel)]',
        'transition-colors duration-[var(--dur-150)] hover:border-[var(--color-border-strong)]',
      ].join(' ')}
    >
      <ScoreRing value={score.score} tone={tone} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-semibold" style={{ color: tone }}>
          {score.label}
        </span>
        <span className="truncate text-xs text-[var(--color-fg-muted)]">{summary}</span>
        {/* Saying nothing here would let the score read as a full check when
            breach data was never fetched. */}
        {!score.breachDataAvailable && score.checked > 0 && (
          <span className="mt-0.5 truncate text-[11px] text-[var(--color-fg-subtle)]">
            Breach check off
          </span>
        )}
      </span>
      <Icon.Chevron className="size-4 shrink-0 -rotate-90 text-[var(--color-fg-subtle)]" />
    </button>
  );
}

function ScoreRing({ value, tone }) {
  const radius = 18;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="relative grid size-12 shrink-0 place-items-center">
      <svg viewBox="0 0 44 44" className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle
          cx="22"
          cy="22"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.15"
          strokeWidth="3.5"
        />
        <circle
          cx="22"
          cy="22"
          r={radius}
          fill="none"
          stroke={tone}
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - value / 100)}
          className="transition-[stroke-dashoffset] duration-[var(--dur-200)] ease-[var(--ease-out-quint)]"
        />
      </svg>
      <span className="tabular relative text-xs font-bold">{value}</span>
    </div>
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
