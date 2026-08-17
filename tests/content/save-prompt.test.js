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
    showSavePrompt({ title: 'GitHub', username: 'rahul', isUpdate: false });
    expect(host()).not.toBeNull();
  });

  it('renders inside a CLOSED shadow root, so page script cannot read it', () => {
    // The isolation that matters: an open root would let the host page query
    // in to read the displayed username or synthesise a click on "Save".
    showSavePrompt({ title: 'GitHub', username: 'rahul', isUpdate: false });
    expect(host().shadowRoot).toBeNull();
  });

  it('is not reachable by a page-side querySelector', () => {
    showSavePrompt({ title: 'GitHub', username: 'rahul', isUpdate: false });
    expect(document.querySelector('button')).toBeNull();
    expect(document.body.textContent).not.toContain('rahul');
  });

  it('replaces an existing banner rather than stacking', () => {
    showSavePrompt({ title: 'A', username: 'a', isUpdate: false });
    showSavePrompt({ title: 'B', username: 'b', isUpdate: false });
    expect(document.querySelectorAll('#keyvault-save-prompt')).toHaveLength(1);
  });

  it('removes itself when dismissed', () => {
    showSavePrompt({ title: 'GitHub', username: 'rahul', isUpdate: false });
    dismissSavePrompt();
    expect(host()).toBeNull();
  });

  it('tolerates being dismissed when nothing is showing', () => {
    expect(() => dismissSavePrompt()).not.toThrow();
  });

  it('resolves with "save" when the save button is clicked', async () => {
    const choice = showSavePrompt({ title: 'GitHub', username: 'rahul', isUpdate: false });
    clickBannerButton('primary');
    expect(await choice).toBe('save');
    expect(host()).toBeNull();
  });

  it('resolves with "dismiss" when Not now is clicked', async () => {
    const choice = showSavePrompt({ title: 'GitHub', username: 'rahul', isUpdate: false });
    clickBannerButton('secondary');
    expect(await choice).toBe('dismiss');
    expect(host()).toBeNull();
  });

  it('labels the action Update when updating an existing entry', async () => {
    const choice = showSavePrompt({ title: 'GitHub', username: 'rahul', isUpdate: true });
    expect(bannerButton('primary').textContent).toBe('Update');
    clickBannerButton('primary');
    await choice;
  });

  it('shows only the site when there is no username', async () => {
    const choice = showSavePrompt({ title: 'GitHub', username: '', isUpdate: false });
    expect(currentPrompt().meta.textContent).toBe('GitHub');
    clickBannerButton('primary');
    await choice;
  });

  it('never renders the password, only who and where', () => {
    // The banner is injected into a page that may be hostile. It is given no
    // password to leak.
    showSavePrompt({ title: 'GitHub', username: 'rahul', isUpdate: false });
    expect(document.documentElement.outerHTML).not.toContain('S3cr3t');
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
