import { describe, it, expect } from 'vitest';
import { createEntry, updateEntry, MAX_PASSWORD_HISTORY } from '../../src/core/entry.js';

const NOW = 1700000000000;

describe('createEntry', () => {
  it('fills defaults for every field', () => {
    const e = createEntry({ title: 'GitHub' }, NOW);
    expect(e.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(e.title).toBe('GitHub');
    expect(e.username).toBe('');
    expect(e.password).toBe('');
    expect(e.urls).toEqual([]);
    expect(e.totp).toBeNull();
    expect(e.notes).toBe('');
    expect(e.folderId).toBeNull();
    expect(e.tags).toEqual([]);
    expect(e.autoSubmit).toBe(false);
    expect(e.passwordHistory).toEqual([]);
    expect(e.createdAt).toBe(NOW);
    expect(e.updatedAt).toBe(NOW);
    expect(e.lastUsedAt).toBeNull();
  });

  it('trims the title', () => {
    expect(createEntry({ title: '  GitHub  ' }, NOW).title).toBe('GitHub');
  });

  it('defaults autoSubmit to false when omitted', () => {
    // Auto-login is the feature most likely to hand credentials to a
    // look-alike domain. It must never be on unless explicitly chosen.
    expect(createEntry({ title: 'x' }, NOW).autoSubmit).toBe(false);
  });

  it('treats any non-true autoSubmit value as false', () => {
    expect(createEntry({ title: 'x', autoSubmit: 'yes' }, NOW).autoSubmit).toBe(false);
    expect(createEntry({ title: 'x', autoSubmit: 1 }, NOW).autoSubmit).toBe(false);
  });

  it('accepts an explicit autoSubmit opt-in', () => {
    expect(createEntry({ title: 'x', autoSubmit: true }, NOW).autoSubmit).toBe(true);
  });

  it('copies array fields rather than aliasing the caller', () => {
    const urls = ['https://a.com'];
    const e = createEntry({ title: 'x', urls }, NOW);
    urls.push('https://b.com');
    expect(e.urls).toEqual(['https://a.com']);
  });

  it('requires a non-empty title', () => {
    expect(() => createEntry({ title: '' }, NOW)).toThrow(RangeError);
    expect(() => createEntry({ title: '   ' }, NOW)).toThrow(RangeError);
    expect(() => createEntry({}, NOW)).toThrow(RangeError);
    expect(() => createEntry(undefined, NOW)).toThrow(RangeError);
  });

  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 100 }, () => createEntry({ title: 't' }, NOW).id));
    expect(ids.size).toBe(100);
  });
});

describe('updateEntry', () => {
  it('applies changes and bumps updatedAt', () => {
    const e = createEntry({ title: 'GitHub' }, NOW);
    const u = updateEntry(e, { title: 'GitHub (work)' }, NOW + 1000);
    expect(u.title).toBe('GitHub (work)');
    expect(u.updatedAt).toBe(NOW + 1000);
    expect(u.createdAt).toBe(NOW);
  });

  it('does not mutate the original entry', () => {
    const e = createEntry({ title: 'GitHub', password: 'old' }, NOW);
    updateEntry(e, { password: 'new' }, NOW + 1000);
    expect(e.password).toBe('old');
    expect(e.passwordHistory).toEqual([]);
  });

  it('records the previous password in history on change', () => {
    const e = createEntry({ title: 'x', password: 'old-pw' }, NOW);
    const u = updateEntry(e, { password: 'new-pw' }, NOW + 1000);
    expect(u.password).toBe('new-pw');
    expect(u.passwordHistory).toEqual([{ password: 'old-pw', changedAt: NOW + 1000 }]);
  });

  it('does not record history when the password is unchanged', () => {
    const e = createEntry({ title: 'x', password: 'same' }, NOW);
    const u = updateEntry(e, { password: 'same', title: 'y' }, NOW + 1000);
    expect(u.passwordHistory).toEqual([]);
  });

  it('does not record history when the previous password was empty', () => {
    const e = createEntry({ title: 'x' }, NOW);
    const u = updateEntry(e, { password: 'first' }, NOW + 1000);
    expect(u.passwordHistory).toEqual([]);
  });

  it('caps history at MAX_PASSWORD_HISTORY, dropping the oldest', () => {
    let e = createEntry({ title: 'x', password: 'pw0' }, NOW);
    for (let i = 1; i <= MAX_PASSWORD_HISTORY + 3; i += 1) {
      e = updateEntry(e, { password: `pw${i}` }, NOW + i);
    }
    expect(e.passwordHistory).toHaveLength(MAX_PASSWORD_HISTORY);
    expect(e.passwordHistory[0].password).toBe(`pw${MAX_PASSWORD_HISTORY + 2}`);
    expect(e.passwordHistory.map((h) => h.password)).not.toContain('pw0');
  });

  it('refuses to change the id', () => {
    const e = createEntry({ title: 'x' }, NOW);
    expect(updateEntry(e, { id: 'hacked' }, NOW + 1).id).toBe(e.id);
  });

  it('refuses to change createdAt', () => {
    const e = createEntry({ title: 'x' }, NOW);
    expect(updateEntry(e, { createdAt: 0 }, NOW + 1).createdAt).toBe(NOW);
  });

  it('refuses to let a caller overwrite password history directly', () => {
    const e = createEntry({ title: 'x', password: 'a' }, NOW);
    const u = updateEntry(e, { passwordHistory: [{ password: 'forged', changedAt: 0 }] }, NOW + 1);
    expect(u.passwordHistory).toEqual([]);
  });

  it('rejects blanking the title', () => {
    const e = createEntry({ title: 'x' }, NOW);
    expect(() => updateEntry(e, { title: '   ' }, NOW + 1)).toThrow(RangeError);
    expect(() => updateEntry(e, { title: '' }, NOW + 1)).toThrow(RangeError);
  });

  it('trims an updated title', () => {
    const e = createEntry({ title: 'x' }, NOW);
    expect(updateEntry(e, { title: '  y  ' }, NOW + 1).title).toBe('y');
  });

  it('applies no changes when called with an empty change set', () => {
    const e = createEntry({ title: 'x' }, NOW);
    const u = updateEntry(e, {}, NOW + 5);
    expect(u.title).toBe('x');
    expect(u.updatedAt).toBe(NOW + 5);
  });

  it('can turn autoSubmit on and back off', () => {
    const e = createEntry({ title: 'x' }, NOW);
    const on = updateEntry(e, { autoSubmit: true }, NOW + 1);
    expect(on.autoSubmit).toBe(true);
    expect(updateEntry(on, { autoSubmit: false }, NOW + 2).autoSubmit).toBe(false);
  });
});
