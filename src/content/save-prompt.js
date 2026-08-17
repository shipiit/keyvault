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
 * The banner shows the password, masked, with a reveal toggle. That adds no
 * exposure — the user just typed it into this page, so the page already has
 * it — and it buys the chance to check what is about to be stored. A
 * detector that picked the wrong field is otherwise invisible until the
 * saved credential fails to log in, weeks later.
 *
 * Every value taken from the page is written with `textContent` or `.value`,
 * never `innerHTML`, so a page title containing markup cannot inject
 * anything into the banner.
 */

const HOST_ID = 'keyvault-save-prompt';

/**
 * The banner currently on screen, if any.
 *
 * Held here because the shadow root is closed and therefore unreachable once
 * created — `dismissSavePrompt` needs a handle to it, and so do the tests,
 * which would otherwise have to prise open the isolation this module exists
 * to provide.
 */
let current = null;

const STYLES = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: inherit; }
  .panel {
    position: fixed; top: 16px; right: 16px; z-index: 2147483647;
    width: 360px;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: #ffffff; color: #16181d;
    border: 1px solid #d9dce3; border-radius: 14px;
    box-shadow: 0 12px 36px rgba(15, 18, 25, 0.18);
    padding: 16px; display: flex; flex-direction: column; gap: 12px;
    animation: enter 160ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  @keyframes enter { from { opacity: 0; transform: translateY(-6px); } }
  @media (prefers-reduced-motion: reduce) { .panel { animation: none; } }

  .head { display: flex; align-items: center; gap: 10px; }
  .mark {
    width: 32px; height: 32px; border-radius: 9px; flex: none;
    background: #4f46e5; display: grid; place-items: center;
  }
  .mark svg { width: 18px; height: 18px; }
  .headings { min-width: 0; }
  .title { font-size: 14px; font-weight: 600; margin: 0; }
  .site { font-size: 12px; color: #5a6172; margin: 0;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .field { display: flex; flex-direction: column; gap: 4px; }
  .label { font-size: 11px; font-weight: 600; color: #5a6172;
           text-transform: uppercase; letter-spacing: 0.04em; }
  .control { position: relative; display: flex; }
  input {
    width: 100%; height: 34px; padding: 0 34px 0 10px;
    border: 1px solid #d9dce3; border-radius: 8px;
    background: #f8f9fb; color: #16181d; font-size: 13px;
  }
  input:hover { border-color: #b9bec9; }
  input:focus-visible { outline: 2px solid #4f46e5; outline-offset: 1px; }
  input.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

  .reveal {
    position: absolute; right: 2px; top: 2px; width: 30px; height: 30px;
    display: grid; place-items: center; cursor: pointer;
    border: 0; background: none; border-radius: 6px; color: #5a6172;
  }
  .reveal:hover { background: #eceef2; color: #16181d; }
  .reveal:focus-visible { outline: 2px solid #4f46e5; outline-offset: 1px; }

  .totp {
    display: flex; align-items: flex-start; gap: 8px; cursor: pointer;
    border: 1px solid #c9d4ee; background: #f2f6ff; border-radius: 9px; padding: 9px 10px;
  }
  .totp input { width: 15px; height: 15px; flex: none; margin: 1px 0 0; padding: 0; accent-color: #4f46e5; }
  .totp .copy { font-size: 12px; line-height: 1.45; }
  .totp .copy b { display: block; font-weight: 600; }
  .totp .copy span { color: #5a6172; }

  .row { display: flex; gap: 8px; margin-top: 2px; }
  button.action {
    flex: 1; height: 36px; border-radius: 9px; font-size: 13px; font-weight: 600;
    cursor: pointer; border: 1px solid transparent;
  }
  button.action:hover { filter: brightness(0.96); }
  button.action:active { transform: translateY(1px); }
  button.action:focus-visible { outline: 2px solid #4f46e5; outline-offset: 2px; }
  .primary { background: #4f46e5; color: #ffffff; }
  .secondary { background: #f4f5f8; color: #16181d; border-color: #d9dce3; }

  @media (prefers-color-scheme: dark) {
    .panel { background: #1c1f26; color: #f2f3f6; border-color: #333844;
             box-shadow: 0 12px 36px rgba(0, 0, 0, 0.55); }
    .site, .label { color: #a2a8b8; }
    input { background: #23262e; border-color: #3a4050; color: #f2f3f6; }
    input:hover { border-color: #4c5364; }
    .reveal { color: #a2a8b8; }
    .reveal:hover { background: #2c303a; color: #f2f3f6; }
    .secondary { background: #262a33; color: #f2f3f6; border-color: #3a4050; }
    .totp { background: #202637; border-color: #3b4a6b; }
    .totp .copy span { color: #a2a8b8; }
  }
`;

const EYE_PATH = 'M1.5 10S4.8 4.5 10 4.5 18.5 10 18.5 10 15.2 15.5 10 15.5 1.5 10 1.5 10Z';

/** @param {boolean} struck */
function eyeIcon(struck) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('width', '15');
  svg.setAttribute('height', '15');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('aria-hidden', 'true');

  const outline = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  outline.setAttribute('d', EYE_PATH);

  const pupil = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  pupil.setAttribute('cx', '10');
  pupil.setAttribute('cy', '10');
  pupil.setAttribute('r', '2.5');

  svg.append(outline, pupil);
  if (struck) {
    const slash = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    slash.setAttribute('d', 'M3 3l14 14');
    svg.append(slash);
  }
  return svg;
}

/**
 * The KeyVault shield, matching the toolbar icon.
 *
 * Built with DOM calls rather than an innerHTML string: this runs inside an
 * arbitrary page, and a habit of assigning markup is how injection bugs get
 * in later even when the current string is a constant.
 *
 * @returns {SVGElement}
 */
function shieldMark() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', '#ffffff');
  svg.setAttribute('aria-hidden', 'true');

  const shield = document.createElementNS(ns, 'path');
  shield.setAttribute('d', 'M12 3.2 4.6 5.9v5.6c0 4.3 2.9 7.8 7.4 9.3 4.5-1.5 7.4-5 7.4-9.3V5.9z');
  svg.append(shield);
  return svg;
}

/**
 * Build a labelled input row.
 *
 * @param {{label: string, value: string, mono?: boolean, type?: string}} config
 */
function buildField({ label, value, mono = false, type = 'text' }) {
  const wrapper = document.createElement('div');
  wrapper.className = 'field';

  const caption = document.createElement('span');
  caption.className = 'label';
  caption.textContent = label;

  const control = document.createElement('div');
  control.className = 'control';

  const input = document.createElement('input');
  input.type = type;
  input.value = value ?? '';
  input.setAttribute('aria-label', label);
  if (mono) {
    input.className = 'mono';
  }
  // Keep other password managers, the browser's own included, away from a
  // field that already holds a captured credential.
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('data-1p-ignore', '');
  input.setAttribute('data-lpignore', 'true');

  control.append(input);
  wrapper.append(caption, control);
  return { wrapper, control, input };
}

/**
 * Show the banner. Resolves with the user's choice and the final values,
 * which the user may have corrected before saving.
 *
 * @param {{title: string, site: string, username: string, password: string,
 *          isUpdate: boolean}} details
 * @returns {Promise<{action: 'save'|'dismiss', title: string, username: string,
 *                    password: string}>}
 */
export function showSavePrompt({ title, site, username, password, isUpdate, totpUri = null }) {
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
    panel.setAttribute('aria-label', isUpdate ? 'Update saved password' : 'Save password');

    const head = document.createElement('div');
    head.className = 'head';

    // The KeyVault shield rather than the site's initial. A letter taken
    // from the page reads as the site's own branding, which is exactly the
    // wrong impression for a prompt asking to store a password.
    const mark = document.createElement('span');
    mark.className = 'mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.append(shieldMark());

    const headings = document.createElement('div');
    headings.className = 'headings';

    const heading = document.createElement('p');
    heading.className = 'title';
    heading.textContent = isUpdate ? 'Update saved password?' : 'Save password to KeyVault?';

    const siteLine = document.createElement('p');
    siteLine.className = 'site';
    siteLine.textContent = site;

    headings.append(heading, siteLine);
    head.append(mark, headings);

    panel.append(head);

    const titleField = buildField({ label: 'Name', value: title });
    const userField = buildField({ label: 'Username', value: username });
    const passField = buildField({
      label: 'Password',
      value: password,
      mono: true,
      type: 'password',
    });

    // Reveal starts off: the banner appears over whatever the user is looking
    // at, which may not be a private setting.
    const reveal = document.createElement('button');
    reveal.type = 'button';
    reveal.className = 'reveal';
    reveal.append(eyeIcon(false));
    reveal.setAttribute('aria-label', 'Show password');
    reveal.setAttribute('aria-pressed', 'false');
    reveal.addEventListener('click', () => {
      const wasShown = passField.input.type === 'text';
      passField.input.type = wasShown ? 'password' : 'text';
      reveal.replaceChildren(eyeIcon(!wasShown));
      reveal.setAttribute('aria-label', wasShown ? 'Show password' : 'Hide password');
      reveal.setAttribute('aria-pressed', String(!wasShown));
    });
    passField.control.append(reveal);
    panel.append(titleField.wrapper, userField.wrapper, passField.wrapper);

    // Offered only when a two-factor secret was actually found on this page.
    // A 2FA setup page shows the login and the QR together, so capturing
    // both in one step is the difference between setting up two-factor and
    // meaning to and never getting round to it.
    let totpCheckbox = null;
    if (totpUri !== null) {
      const totpRow = document.createElement('label');
      totpRow.className = 'totp';

      totpCheckbox = document.createElement('input');
      totpCheckbox.type = 'checkbox';
      totpCheckbox.checked = true;

      const copy = document.createElement('span');
      copy.className = 'copy';
      const heading = document.createElement('b');
      heading.textContent = 'Also save the two-factor code';
      const detail = document.createElement('span');
      detail.textContent = 'A setup code was found on this page.';
      copy.append(heading, detail);

      totpRow.append(totpCheckbox, copy);
      panel.append(totpRow);
    }

    const row = document.createElement('div');
    row.className = 'row';

    const finish = (action) => {
      const result = {
        action,
        title: titleField.input.value.trim(),
        username: userField.input.value,
        password: passField.input.value,
        totpUri: totpCheckbox?.checked === true ? totpUri : null,
      };
      host.remove();
      current = null;
      resolve(result);
    };

    const notNow = document.createElement('button');
    notNow.className = 'action secondary';
    notNow.type = 'button';
    notNow.textContent = 'Not now';
    notNow.addEventListener('click', () => finish('dismiss'));

    const save = document.createElement('button');
    save.className = 'action primary';
    save.type = 'button';
    save.textContent = isUpdate ? 'Update' : 'Save';
    save.addEventListener('click', () => finish('save'));

    panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        finish('dismiss');
      }
      if (event.key === 'Enter' && event.target !== notNow) {
        finish('save');
      }
    });

    row.append(notNow, save);
    panel.append(row);
    shadow.append(style, panel);
    document.documentElement.append(host);

    current = {
      host,
      panel,
      siteLine,
      titleInput: titleField.input,
      usernameInput: userField.input,
      passwordInput: passField.input,
      revealButton: reveal,
      saveButton: save,
      dismissButton: notNow,
      totpCheckbox,
    };
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
