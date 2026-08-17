/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/preact';
import { ItemDrawer } from '../../src/ui/vault/ItemDrawer.jsx';

afterEach(cleanup);

/**
 * The security-relevant defaults of the item form.
 *
 * Most of this form is presentation, but a new item arriving with auto-login
 * already enabled would submit credentials to a page the user never agreed to
 * trust — including a look-alike domain. The background also refuses to
 * enable it on save, so this is the second of two independent guards.
 */
describe('ItemDrawer security defaults', () => {
  it('leaves "Sign in automatically" off for a new item', () => {
    render(<ItemDrawer entry={null} onSave={vi.fn()} onClose={vi.fn()} />);
    const toggle = screen.getByRole('switch', { name: 'Sign in automatically' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('leaves two-factor off for a new item', () => {
    render(<ItemDrawer entry={null} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(
      screen.getByRole('switch', { name: 'Enable two-factor code' }).getAttribute('aria-checked'),
    ).toBe('false');
  });

  it('reflects an existing entry that opted in, rather than resetting it', () => {
    render(
      <ItemDrawer
        entry={{ id: 'a', title: 'GitHub', autoSubmit: true, urls: [], passwordHistory: [] }}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('switch', { name: 'Sign in automatically' }).getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('offers every item type, all selectable', () => {
    render(<ItemDrawer entry={null} onSave={vi.fn()} onClose={vi.fn()} />);
    const types = screen.getAllByRole('radio');
    expect(types.map((button) => button.textContent.trim())).toEqual([
      'Login',
      'Secure Note',
      'Card',
      'Identity',
      'Document',
    ]);
    expect(types.every((button) => !button.disabled)).toBe(true);
  });

  it('defaults to a login', () => {
    render(<ItemDrawer entry={null} onSave={vi.fn()} onClose={vi.fn()} />);
    const checked = screen
      .getAllByRole('radio')
      .filter((b) => b.getAttribute('aria-checked') === 'true');
    expect(checked).toHaveLength(1);
    expect(checked[0].textContent.trim()).toBe('Login');
  });

  it('opens an existing entry on its own type', () => {
    render(
      <ItemDrawer
        entry={{ id: 'a', type: 'card', title: 'Visa', urls: [], passwordHistory: [] }}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // The type selector is hidden while editing, so the check is that the
    // login-only username field is not offered for a card.
    expect(screen.queryByLabelText('Username or email')).toBeNull();
  });

  it('warns about the risk at the point of decision', () => {
    // Burying this in settings would mean the user opts in without ever
    // reading why it is off by default.
    render(<ItemDrawer entry={null} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(document.body.textContent).toMatch(/look-alike/i);
  });
});
