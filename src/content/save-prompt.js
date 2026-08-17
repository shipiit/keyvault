/**
 * The "Save this password?" banner.
 *
 * Rendered inside a **closed shadow root** attached to an element appended to
 * `documentElement`. Two reasons, both load-bearing:
 *
 *  - Style isolation. The host page's CSS cannot reach in and reposition,
 *    hide, or restyle the banner into something misleading.
 *  - Script isolation. A closed root means page script cannot query into it
 *    to read what is displayed or synthesise clicks on its buttons.
 *
 * The banner shows the username and the site, never the password.
 */

const HOST_ID = 'keyvault-save-prompt';

/**
 * The banner currently on screen, if any.
 *
 * Held here because the shadow root is closed and therefore unreachable
 * once created — `dismissSavePrompt` needs a handle to it, and so do the
 * tests, which would otherwise have to prise open the isolation this
 * module exists to provide.
 */
let current = null;

const STYLES = `
  :host { all: initial; }
  .panel {
    position: fixed; top: 16px; right: 16px; z-index: 2147483647;
    width: 320px; box-sizing: border-box;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: #ffffff; color: #16181d;
    border: 1px solid #d9dce3; border-radius: 12px;
    box-shadow: 0 8px 28px rgba(15, 18, 25, 0.16);
    padding: 14px; display: flex; flex-direction: column; gap: 10px;
    animation: enter 160ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  @keyframes enter { from { opacity: 0; transform: translateY(-6px); } }
  @media (prefers-reduced-motion: reduce) { .panel { animation: none; } }
  @media (prefers-color-scheme: dark) {
    .panel { background: #1c1f26; color: #f2f3f6; border-color: #333844;
             box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5); }
    .meta { color: #a2a8b8 !important; }
    .secondary { background: #262a33 !important; color: #f2f3f6 !important;
                 border-color: #3a4050 !important; }
  }
  .title { font-size: 14px; font-weight: 600; margin: 0; }
  .meta { font-size: 12px; color: #5a6172; margin: 0;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row { display: flex; gap: 8px; margin-top: 2px; }
  button {
    flex: 1; height: 32px; border-radius: 8px; font-size: 13px; font-weight: 500;
    cursor: pointer; border: 1px solid transparent;
    font-family: inherit; transition: filter 120ms;
  }
  button:hover { filter: brightness(0.95); }
  button:active { transform: translateY(1px); }
  button:focus-visible { outline: 2px solid #4f46e5; outline-offset: 2px; }
  .primary { background: #4f46e5; color: #ffffff; }
  .secondary { background: #f4f5f8; color: #16181d; border-color: #d9dce3; }
`;

/**
 * Show the banner. Resolves with the user's choice.
 *
 * @param {{title: string, username: string, isUpdate: boolean}} details
 * @returns {Promise<'save'|'dismiss'>}
 */
export function showSavePrompt({ title, username, isUpdate }) {
  dismissSavePrompt();

  return new Promise((resolve) => {
    const host = document.createElement('div');
    host.id = HOST_ID;
    // Closed: page script cannot reach in to read or click.
    const shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = STYLES;

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'KeyVault save password');

    const heading = document.createElement('p');
    heading.className = 'title';
    heading.textContent = isUpdate ? 'Update saved password?' : 'Save password to KeyVault?';

    const meta = document.createElement('p');
    meta.className = 'meta';
    // textContent, never innerHTML: `title` and `username` come from the page.
    meta.textContent = username === '' ? title : `${username} — ${title}`;

    const row = document.createElement('div');
    row.className = 'row';

    const finish = (choice) => {
      host.remove();
      current = null;
      resolve(choice);
    };

    const notNow = document.createElement('button');
    notNow.className = 'secondary';
    notNow.type = 'button';
    notNow.textContent = 'Not now';
    notNow.addEventListener('click', () => finish('dismiss'));

    const save = document.createElement('button');
    save.className = 'primary';
    save.type = 'button';
    save.textContent = isUpdate ? 'Update' : 'Save';
    save.addEventListener('click', () => finish('save'));

    row.append(notNow, save);
    panel.append(heading, meta, row);
    shadow.append(style, panel);
    document.documentElement.append(host);

    current = { host, panel, meta, saveButton: save, dismissButton: notNow };
    save.focus();
  });
}

/** Remove any banner currently on screen. */
export function dismissSavePrompt() {
  current?.host.remove();
  current = null;
  // Belt and braces: a banner from a previous document state could still be
  // attached if the page replaced documentElement under us.
  document.getElementById(HOST_ID)?.remove();
}

/**
 * The live banner's elements, or null.
 *
 * Exists so tests can drive the banner without opening the shadow root.
 * Reading this from page script is impossible — it is module scope inside an
 * isolated content-script world, not something attached to the document.
 */
export function currentPrompt() {
  return current;
}

/**
 * Whether a submitted credential is worth offering to save.
 *
 * @param {{username: string, password: string}} submitted
 * @param {Array<{username: string}>} known entries already saved for this site
 * @returns {{worthSaving: boolean, isUpdate: boolean}}
 */
export function shouldOfferToSave(submitted, known) {
  if (typeof submitted.password !== 'string' || submitted.password === '') {
    return { worthSaving: false, isUpdate: false };
  }

  const match = known.find((entry) => (entry.username ?? '') === (submitted.username ?? ''));
  if (match === undefined) {
    return { worthSaving: true, isUpdate: false };
  }

  // A saved entry exists for this username. Offering an update is only
  // useful if something changed — but the content script never sees the
  // stored password, so the background decides. Offer, and let it compare.
  return { worthSaving: true, isUpdate: true };
}
