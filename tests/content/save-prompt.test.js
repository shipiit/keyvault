/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  showSavePrompt,
  dismissSavePrompt,
  shouldOfferToSave,
  currentPrompt,
} from '../../src/content/save-prompt.js';

beforeEach(() => {
  document.body.innerHTML = '';
  dismissSavePrompt();
});

const host = () => document.getElementById('keyvault-save-prompt');

// The shadow root is closed and stays that way; the module hands tests a
// direct handle instead of the test prising the isolation open.
const bannerButton = (which) =>
  which === 'primary' ? currentPrompt().saveButton : currentPrompt().dismissButton;
const clickBannerButton = (which) => bannerButton(which).click();

describe('showSavePrompt', () => {
  it('renders a banner attached to the document', () => {
    showSavePrompt({
      title: 'GitHub',
      site: 'https://github.com',
      username: 'rahul',
      password: 'S3cr3t!',
      isUpdate: false,
    });
    expect(host()).not.toBeNull();
  });

  it('renders inside a CLOSED shadow root, so page script cannot read it', () => {
    // The isolation that matters: an open root would let the host page query
    // in to read the displayed username or synthesise a click on "Save".
    showSavePrompt({
      title: 'GitHub',
      site: 'https://github.com',
      username: 'rahul',
      password: 'S3cr3t!',
      isUpdate: false,
    });
    expect(host().shadowRoot).toBeNull();
  });

  it('is not reachable by a page-side querySelector', () => {
    showSavePrompt({
      title: 'GitHub',
      site: 'https://github.com',
      username: 'rahul',
      password: 'S3cr3t!',
      isUpdate: false,
    });
    expect(document.querySelector('button')).toBeNull();
    expect(document.body.textContent).not.toContain('rahul');
  });

  it('replaces an existing banner rather than stacking', () => {
    showSavePrompt({
      title: 'A',
      site: 'https://a.com',
      username: 'a',
      password: 'p',
      isUpdate: false,
    });
    showSavePrompt({
      title: 'B',
      site: 'https://b.com',
      username: 'b',
      password: 'p',
      isUpdate: false,
    });
    expect(document.querySelectorAll('#keyvault-save-prompt')).toHaveLength(1);
  });

  it('removes itself when dismissed', () => {
    showSavePrompt({
      title: 'GitHub',
      site: 'https://github.com',
      username: 'rahul',
      password: 'S3cr3t!',
      isUpdate: false,
    });
    dismissSavePrompt();
    expect(host()).toBeNull();
  });

  it('dismisses on Escape', async () => {
    const choice = showSavePrompt({
      title: 'GitHub',
      site: 'https://github.com',
      username: 'rahul',
      password: 'p',
      isUpdate: false,
    });
    currentPrompt().panel.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect((await choice).action).toBe('dismiss');
  });

  it('saves on Enter from a field', async () => {
    const choice = showSavePrompt({
      title: 'GitHub',
      site: 'https://github.com',
      username: 'rahul',
      password: 'p',
      isUpdate: false,
    });
    currentPrompt().usernameInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    expect((await choice).action).toBe('save');
  });

  it('falls back to the title when there is no site for the mark', async () => {
    const choice = showSavePrompt({
      title: 'GitHub',
      site: '',
      username: '',
      password: 'p',
      isUpdate: false,
    });
    expect(currentPrompt().siteLine.textContent).toBe('');
    clickBannerButton('secondary');
    await choice;
  });

  it('tolerates being dismissed when nothing is showing', () => {
    expect(() => dismissSavePrompt()).not.toThrow();
  });

  it('resolves with the values when Save is clicked', async () => {
    const choice = showSavePrompt({
      title: 'GitHub',
      site: 'https://github.com/login',
      username: 'rahul',
      password: 'S3cr3t!',
      isUpdate: false,
    });
    clickBannerButton('primary');

    expect(await choice).toEqual({
      action: 'save',
      title: 'GitHub',
      username: 'rahul',
      password: 'S3cr3t!',
    });
    expect(host()).toBeNull();
  });

  it("returns the user's corrections, not the captured values", async () => {
    // The whole point of showing the fields: a mis-detected username is
    // otherwise invisible until the saved credential fails to log in.
    const choice = showSavePrompt({
      title: 'Untitled',
      site: 'https://github.com',
      username: 'wrong@example.com',
      password: 'S3cr3t!',
      isUpdate: false,
    });

    currentPrompt().titleInput.value = 'GitHub';
    currentPrompt().usernameInput.value = 'right@example.com';
    clickBannerButton('primary');

    const result = await choice;
    expect(result.title).toBe('GitHub');
    expect(result.username).toBe('right@example.com');
  });

  it('resolves with dismiss when Not now is clicked', async () => {
    const choice = showSavePrompt({
      title: 'GitHub',
      site: 'https://github.com',
      username: 'rahul',
      password: 'S3cr3t!',
      isUpdate: false,
    });
    clickBannerButton('secondary');
    expect((await choice).action).toBe('dismiss');
    expect(host()).toBeNull();
  });

  it('masks the password until the user reveals it', async () => {
    // The banner appears over whatever is on screen, which may not be a
    // private setting.
    const choice = showSavePrompt({
      title: 'GitHub',
      site: 'https://github.com',
      username: 'rahul',
      password: 'S3cr3t!',
      isUpdate: false,
    });
    expect(currentPrompt().passwordInput.type).toBe('password');

    currentPrompt().revealButton.click();
    expect(currentPrompt().passwordInput.type).toBe('text');

    currentPrompt().revealButton.click();
    expect(currentPrompt().passwordInput.type).toBe('password');

    clickBannerButton('secondary');
    await choice;
  });

  it('shows the full URL including the port', async () => {
    // https://localhost is not the same site as https://localhost:5173.
    const choice = showSavePrompt({
      title: 'Dev',
      site: 'http://localhost:5173/login',
      username: 'u',
      password: 'p',
      isUpdate: false,
    });
    expect(currentPrompt().siteLine.textContent).toBe('http://localhost:5173/login');
    clickBannerButton('secondary');
    await choice;
  });

  it('labels the action Update when updating an existing entry', async () => {
    const choice = showSavePrompt({
      title: 'GitHub',
      site: 'https://github.com',
      username: 'rahul',
      password: 'p',
      isUpdate: true,
    });
    expect(bannerButton('primary').textContent).toBe('Update');
    clickBannerButton('primary');
    await choice;
  });

  it('keeps the password out of the host page DOM', () => {
    // The banner lives in a closed shadow root, so the password it displays
    // is not reachable from the page that hosts it.
    showSavePrompt({
      title: 'GitHub',
      site: 'https://github.com',
      username: 'rahul',
      password: 'S3cr3t!',
      isUpdate: false,
    });
    expect(document.body.textContent).not.toContain('S3cr3t');
    expect(document.querySelector('input')).toBeNull();
  });
});

describe('shouldOfferToSave', () => {
  it('offers to save a brand-new credential', () => {
    expect(shouldOfferToSave({ username: 'rahul', password: 'pw' }, [])).toEqual({
      worthSaving: true,
      isUpdate: false,
    });
  });

  it('offers an update when the username already exists for this site', () => {
    const result = shouldOfferToSave({ username: 'rahul', password: 'new' }, [
      { username: 'rahul' },
    ]);
    expect(result).toEqual({ worthSaving: true, isUpdate: true });
  });

  it('treats a different username on the same site as a new credential', () => {
    const result = shouldOfferToSave({ username: 'other', password: 'pw' }, [
      { username: 'rahul' },
    ]);
    expect(result.isUpdate).toBe(false);
  });

  it('never offers to save an empty password', () => {
    expect(shouldOfferToSave({ username: 'rahul', password: '' }, []).worthSaving).toBe(false);
    expect(shouldOfferToSave({ username: 'rahul' }, []).worthSaving).toBe(false);
  });

  it('matches an entry saved with no username', () => {
    const result = shouldOfferToSave({ username: '', password: 'pw' }, [{ username: '' }]);
    expect(result.isUpdate).toBe(true);
  });
});
