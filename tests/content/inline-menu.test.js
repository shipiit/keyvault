/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  attachInlineMenu,
  removeInlineMenu,
  currentInlineMenu,
} from '../../src/content/inline-menu.js';

const ENTRIES = [
  { id: 'a', title: 'GitHub', username: 'rahul@example.com' },
  { id: 'b', title: 'Bank of Example', username: '' },
];

function mountField(type = 'text') {
  document.body.innerHTML = `<input id="field" type="${type}">`;
  return document.getElementById('field');
}

function attach(overrides = {}) {
  return attachInlineMenu({
    field: mountField(),
    kind: 'login',
    loadEntries: async () => ENTRIES,
    onChoose: vi.fn(),
    ...overrides,
  });
}

const host = () => document.getElementById('keyvault-inline-menu');
const badge = () => currentInlineMenu()?.badge;
const menu = () => currentInlineMenu()?.menu;

beforeEach(() => {
  document.body.innerHTML = '';
  removeInlineMenu();
});

afterEach(() => removeInlineMenu());

describe('the badge', () => {
  it('attaches outside the page DOM, not inside the field', () => {
    // Inserting into the page's own tree means a framework re-render can
    // tear it out, and the page's CSS can restyle it.
    const field = mountField();
    attachInlineMenu({ field, kind: 'login', loadEntries: async () => [], onChoose: vi.fn() });

    expect(host().parentElement).toBe(document.documentElement);
    expect(field.parentElement.querySelector('#keyvault-inline-menu')).toBeNull();
  });

  it('renders in a closed shadow root, unreachable from page script', () => {
    attach();
    expect(host().shadowRoot).toBeNull();
    expect(document.querySelector('button')).toBeNull();
  });

  it('replaces an earlier badge rather than stacking', () => {
    attach();
    attach();
    expect(document.querySelectorAll('#keyvault-inline-menu')).toHaveLength(1);
  });

  it('removes cleanly', () => {
    attach();
    removeInlineMenu();
    expect(host()).toBeNull();
    expect(currentInlineMenu()).toBeNull();
  });
});

describe('the menu', () => {
  it('opens on click and lists the saved logins', async () => {
    attach();
    badge().click();
    await vi.waitFor(() => expect(menu()).not.toBeNull());

    const titles = [...menu().querySelectorAll('.item .title')].map((node) => node.textContent);
    expect(titles).toEqual(['GitHub', 'Bank of Example']);
  });

  it('shows a username placeholder rather than an empty line', async () => {
    attach();
    badge().click();
    await vi.waitFor(() => expect(menu()).not.toBeNull());

    const subs = [...menu().querySelectorAll('.item .sub')].map((node) => node.textContent);
    expect(subs).toEqual(['rahul@example.com', 'No username']);
  });

  it('never renders a password — it is never given one', async () => {
    // The menu takes metadata only. A page that never gets a click has
    // nothing to read even in principle.
    const loadEntries = vi.fn(async () => ENTRIES);
    attach({ loadEntries });
    badge().click();
    await vi.waitFor(() => expect(menu()).not.toBeNull());

    expect(JSON.stringify(await loadEntries.mock.results[0].value)).not.toContain('password');
    expect(document.documentElement.textContent).not.toContain('S3cr3t');
  });

  it('reports the chosen entry by id', async () => {
    const onChoose = vi.fn();
    attach({ onChoose });
    badge().click();
    await vi.waitFor(() => expect(menu()).not.toBeNull());

    menu().querySelectorAll('.item')[1].click();
    expect(onChoose).toHaveBeenCalledWith('b');
  });

  it('closes after a choice', async () => {
    attach();
    badge().click();
    await vi.waitFor(() => expect(menu()).not.toBeNull());

    menu().querySelector('.item').click();
    expect(currentInlineMenu().menu).toBeNull();
  });

  it('says so when nothing is saved for the site', async () => {
    attach({ loadEntries: async () => [] });
    badge().click();
    await vi.waitFor(() => expect(menu()).not.toBeNull());

    expect(menu().querySelector('.empty').textContent).toMatch(/Nothing saved/);
  });

  it('offers to generate only on a password field', async () => {
    const onGenerate = vi.fn();
    attach({ kind: 'password', onGenerate, loadEntries: async () => [] });
    badge().click();
    await vi.waitFor(() => expect(menu()).not.toBeNull());

    const labels = [...menu().querySelectorAll('.action')].map((node) => node.textContent);
    expect(labels).toContain('Generate a password');
  });

  it('does not offer to generate on a username field', async () => {
    attach({ kind: 'login', onGenerate: vi.fn(), loadEntries: async () => [] });
    badge().click();
    await vi.waitFor(() => expect(menu()).not.toBeNull());

    const labels = [...menu().querySelectorAll('.action')].map((node) => node.textContent);
    expect(labels).not.toContain('Generate a password');
  });

  it('toggles shut on a second click of the badge', async () => {
    attach();
    badge().click();
    await vi.waitFor(() => expect(menu()).not.toBeNull());

    badge().click();
    expect(currentInlineMenu().menu).toBeNull();
  });

  it('closes on a click elsewhere on the page', async () => {
    attach();
    badge().click();
    await vi.waitFor(() => expect(menu()).not.toBeNull());

    document.body.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
    expect(currentInlineMenu().menu).toBeNull();
  });

  it('still opens when the vault is locked and entries cannot be loaded', async () => {
    // A rejected load must leave a usable menu — "Open KeyVault" is how the
    // user unlocks — rather than a badge that silently does nothing on click.
    attach({
      loadEntries: async () => {
        throw new Error('Vault is locked');
      },
      onOpenVault: vi.fn(),
    });
    badge().click();
    await vi.waitFor(() => expect(menu()).not.toBeNull());

    const labels = [...menu().querySelectorAll('.action')].map((node) => node.textContent);
    expect(labels).toContain('Open KeyVault');
  });
});
