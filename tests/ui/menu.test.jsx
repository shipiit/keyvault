/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/preact';
import { Menu } from '../../src/ui/vault/Menu.jsx';

afterEach(cleanup);

/**
 * fireEvent rather than a bare `.click()`: fireEvent is wrapped in act, so
 * Preact flushes effects. A raw click renders the menu but leaves its
 * effects unrun, which silently disables the outside-click and focus
 * behaviour the tests below are checking.
 */
function open(items) {
  render(<Menu label="More actions" items={items} />);
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
  return screen.findByRole('menu');
}

const basic = (onSelect = vi.fn()) => [
  { label: 'Copy username', onSelect },
  { label: 'Copy password', onSelect },
  { type: 'separator' },
  { label: 'Delete item', tone: 'danger', onSelect },
];

describe('Menu', () => {
  it('stays closed until the trigger is used', () => {
    render(<Menu label="More actions" items={basic()} />);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens on click and lists its actions', async () => {
    await open(basic());
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Copy username',
      'Copy password',
      'Delete item',
    ]);
  });

  it('runs the chosen action and closes', async () => {
    const onSelect = vi.fn();
    await open(basic(onSelect));

    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy password' }));

    await waitFor(() => expect(onSelect).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('does not run a disabled action', async () => {
    const onSelect = vi.fn();
    await open([{ label: 'Copy one-time code', disabled: true, onSelect }]);

    const item = screen.getByRole('menuitem', { name: 'Copy one-time code' });
    expect(item.disabled).toBe(true);
    fireEvent.click(item);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('moves through items with the arrow keys', async () => {
    // A menu that only works with a mouse is a menu whose actions are
    // unreachable from the keyboard.
    const menu = await open(basic());
    const items = screen.getAllByRole('menuitem');

    await waitFor(() => expect(document.activeElement).toBe(items[0]));

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    await waitFor(() => expect(document.activeElement).toBe(items[1]));

    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
  });

  it('wraps around at the ends', async () => {
    const menu = await open(basic());
    const items = screen.getAllByRole('menuitem');

    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    await waitFor(() => expect(document.activeElement).toBe(items.at(-1)));
  });

  it('jumps to first and last with Home and End', async () => {
    const menu = await open(basic());
    const items = screen.getAllByRole('menuitem');

    fireEvent.keyDown(menu, { key: 'End' });
    await waitFor(() => expect(document.activeElement).toBe(items.at(-1)));

    fireEvent.keyDown(menu, { key: 'Home' });
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const menu = await open(basic());
    fireEvent.keyDown(menu, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'More actions' }));
  });

  it('closes on a click outside', async () => {
    await open(basic());
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('renders separators as separators, not as actions', async () => {
    await open(basic());
    expect(screen.getAllByRole('separator')).toHaveLength(1);
    expect(screen.getAllByRole('menuitem')).toHaveLength(3);
  });

  it('marks the trigger as owning a menu', () => {
    render(<Menu label="More actions" items={basic()} />);
    const trigger = screen.getByRole('button', { name: 'More actions' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});
