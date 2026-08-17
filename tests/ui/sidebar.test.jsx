/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/preact';
import { Sidebar } from '../../src/ui/vault/Sidebar.jsx';

afterEach(cleanup);

const EMPTY_COUNTS = {
  all: 0,
  favorites: 0,
  recent: 0,
  trash: 0,
  login: 0,
  note: 0,
  card: 0,
  identity: 0,
  document: 0,
};

function show(counts, view = 'all') {
  render(
    <Sidebar
      view={view}
      counts={{ ...EMPTY_COUNTS, ...counts }}
      onSelectView={vi.fn()}
      score={null}
      onOpenScore={vi.fn()}
      collapsed={false}
      onToggle={vi.fn()}
    />,
  );
  return screen
    .queryAllByRole('button')
    .map((button) => button.textContent.replace(/\d+$/, '').trim());
}

describe('Sidebar shows only rows that have something in them', () => {
  it('hides every empty category on a fresh vault', () => {
    // A column of zeroes is noise, and makes an empty vault look broken.
    const rows = show({});
    expect(rows).toContain('All Items');
    expect(rows).not.toContain('Cards');
    expect(rows).not.toContain('Identities');
    expect(rows).not.toContain('Documents');
    expect(rows).not.toContain('Secure Notes');
  });

  it('always keeps All Items, so the sidebar is never empty', () => {
    expect(show({})).toContain('All Items');
  });

  it('hides the Categories heading entirely when none have items', () => {
    render(
      <Sidebar
        view="all"
        counts={EMPTY_COUNTS}
        onSelectView={vi.fn()}
        score={null}
        onOpenScore={vi.fn()}
        collapsed={false}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.queryByText('Categories')).toBeNull();
  });

  it('shows a category as soon as it has an item', () => {
    const rows = show({ all: 2, login: 1, card: 1 });
    expect(rows).toContain('Logins');
    expect(rows).toContain('Cards');
    expect(rows).not.toContain('Documents');
  });

  it('keeps the selected row visible even when it empties', () => {
    // Deleting the last card while viewing Cards must not make the view you
    // are looking at disappear from under you.
    expect(show({ all: 1, login: 1 }, 'card')).toContain('Cards');
  });

  it('hides Trash and Favorites until they have something', () => {
    const rows = show({ all: 3, login: 3 });
    expect(rows).not.toContain('Trash');
    expect(rows).not.toContain('Favorites');

    cleanup();
    expect(show({ all: 3, login: 3, favorites: 1 })).toContain('Favorites');
  });
});
