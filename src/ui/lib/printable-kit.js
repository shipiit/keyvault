/**
 * The recovery kit as a standalone document, built for paper.
 *
 * The obvious approach — a print stylesheet over the page you are looking at
 * — fails in two ways that only appear once someone actually presses Print.
 *
 * The extension popup cannot print at all. `window.print()` is called and
 * Chrome ignores it, because a popup is dismissed the moment focus moves to a
 * dialog. So the button appears broken to anyone who has not thought to open
 * the full vault page first, which is nobody.
 *
 * And the app is themed. In dark mode every colour on that sheet is a light
 * grey chosen to sit on a dark background; forcing the paper white leaves
 * white text on white paper. The page that looks right on screen is the one
 * that prints blank.
 *
 * A separate document sidesteps both. It opens in a real tab, which can
 * print, and it carries its own black-on-white styling that owes nothing to
 * the theme. It contains no script, so it needs no exception to the
 * extension's content security policy.
 */

/**
 * Escape text for inclusion in HTML.
 *
 * Everything here is generated rather than typed by a user, which is exactly
 * the reasoning that leads to an injection bug two refactors later. It costs
 * one function.
 *
 * @param {unknown} value
 */
function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
}

/**
 * @param {{fingerprint: string, entryCount: number, version: string, generatedAt: number}} kit
 * @param {{masterPassword?: string, backupLocation?: string}} [filled] values the
 *   user chose to have printed rather than write in by hand
 * @returns {string} a complete HTML document
 */
export function printableRecoveryHtml(kit, filled = {}) {
  const printed = new Date(kit.generatedAt).toLocaleDateString();

  // A filled box is printed as text; an empty one stays a ruled line to write
  // on. Both are legitimate: writing it by hand keeps the password out of the
  // print spooler, and printing it is what someone wants when the sheet is
  // going straight into a safe.
  const box = (value, rules) =>
    typeof value === 'string' && value.trim() !== ''
      ? `<div class="write"><div class="filled">${escapeHtml(value)}</div></div>`
      : `<div class="write">${'<div class="rule"></div>'.repeat(rules)}</div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>KeyVault Recovery Kit</title>
<style>
  /* Absolute colours, not tokens. This document must look identical whether
     the app was in light or dark mode when it was produced. */
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 40px;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #000; background: #fff;
    font-size: 13px; line-height: 1.55;
  }
  h1 { font-size: 22px; margin: 0; letter-spacing: -0.2px; }
  h2 { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;
       color: #555; margin: 22px 0 6px; }
  p { margin: 4px 0; }
  .muted { color: #555; font-size: 11.5px; }
  header { display: flex; gap: 12px; align-items: center;
           border-bottom: 2px solid #000; padding-bottom: 12px; }
  .mark { width: 38px; height: 38px; flex: none; border-radius: 9px;
          background: #4f46e5; display: grid; place-items: center; }
  .mark svg { width: 22px; height: 22px; fill: #fff; }
  dl { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px 24px; margin: 0; }
  dt { font-size: 11px; color: #555; }
  dd { margin: 0; font-weight: 700; font-size: 14px; }
  .id { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; letter-spacing: 1px; }
  /* Ruled boxes: the point of the sheet is that these get written in. */
  .write { border: 1.5px dashed #999; border-radius: 8px; padding: 14px 16px; }
  .rule { border-bottom: 1px solid #333; height: 26px; }
  .rule + .rule { margin-top: 14px; }
  .filled { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
            font-size: 15px; font-weight: 700; word-break: break-all; letter-spacing: 0.5px; }
  .warn { border: 1.5px solid #000; border-radius: 8px; padding: 10px 12px; margin-top: 18px; }
  ol { margin: 6px 0 0; padding-left: 20px; }
  li { margin: 3px 0; }
  code { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 11.5px; }
  footer { margin-top: 24px; border-top: 1px solid #999; padding-top: 10px; }
  @page { margin: 14mm; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <header>
    <span class="mark">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3.2 4.6 5.9v5.6c0 4.3 2.9 7.8 7.4 9.3 4.5-1.5 7.4-5 7.4-9.3V5.9z"/>
      </svg>
    </span>
    <span>
      <h1>KeyVault Recovery Kit</h1>
      <p class="muted">Keep this on paper. Do not photograph it or store it in another password manager.</p>
    </span>
  </header>

  <h2>This vault</h2>
  <dl>
    <div><dt>Vault ID</dt><dd class="id">${escapeHtml(kit.fingerprint)}</dd></div>
    <div><dt>Items at printing</dt><dd>${escapeHtml(kit.entryCount)}</dd></div>
    <div><dt>KeyVault version</dt><dd>${escapeHtml(kit.version)}</dd></div>
  </dl>
  <p class="muted">Printed ${escapeHtml(printed)}. The vault ID says which vault a backup file
  belongs to. It is not a secret and it cannot open anything.</p>

  <h2>Master password</h2>
  <p class="muted">${
    typeof filled.masterPassword === 'string' && filled.masterPassword.trim() !== ''
      ? 'Printed below at your request. KeyVault does not store it — this copy exists only on ' +
        'this sheet, so treat the sheet as the password itself.'
      : 'Write it here by hand. KeyVault does not know it and cannot print it — it is never ' +
        'stored anywhere, which is the reason nobody can be asked to reset it.'
  }</p>
  ${box(filled.masterPassword, 2)}

  <h2>Where the backup file is</h2>
  <p class="muted">A backup is an encrypted file exported from Settings. Without one this sheet
  cannot rebuild anything on a new machine — the password alone is not enough.</p>
  ${box(filled.backupLocation, 1)}

  <h2>How to get back in</h2>
  <ol>
    <li>Install KeyVault from <code>github.com/shipiit/keyvault</code> and follow <code>INSTALL.md</code>.</li>
    <li>Create a vault. Any password will do at this step; the import replaces it.</li>
    <li>Open Settings, choose Import, and select the backup file named above.</li>
    <li>Enter the master password written above. Your items come back.</li>
  </ol>

  ${
    typeof filled.masterPassword === 'string' && filled.masterPassword.trim() !== ''
      ? '<div class="warn"><strong>This sheet contains your master password.</strong> ' +
        'Anyone holding it can open your vault. Keep it where you would keep a passport or ' +
        'a deed — not in a desk drawer, not photographed, not in a shared printer tray.</div>'
      : ''
  }

  <footer>
    <p class="muted"><strong>If you lose the master password, the items are gone.</strong>
    Not withheld — gone. The vault is encrypted with a key derived from that password, no copy
    of it exists, and no part of this project can recover it. That is the trade for having no
    server that could be compelled or breached.</p>
  </footer>
</body>
</html>`;
}

/**
 * Open the kit in its own tab and offer it to the printer.
 *
 * @param {object} kit
 * @param {{masterPassword?: string, backupLocation?: string}} [filled]
 * @param {Window} [opener]
 * @returns {boolean} false if the browser refused to open a window
 */
export function openPrintableKit(kit, filled = {}, opener = window) {
  const tab = opener.open('', '_blank');
  if (tab === null) {
    return false;
  }
  tab.document.write(printableRecoveryHtml(kit, filled));
  tab.document.close();
  // Print after the document settles. Calling into a half-written document
  // prints a blank page on some builds.
  tab.setTimeout(() => tab.print(), 250);
  return true;
}
