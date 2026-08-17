/**
 * Content script.
 *
 * Runs inside every page the user visits, which makes it the least trusted
 * code in the extension. It holds no secrets of its own and can ask the
 * background for only a narrow set of things — never the vault, never the
 * key. The background re-checks the origin before releasing any password, so
 * nothing here is trusted to have got that right.
 */

import { detectLoginForms } from './field-detector.js';
import { fillCredential, submitForm } from './filler.js';
import { showSavePrompt, dismissSavePrompt, shouldOfferToSave } from './save-prompt.js';
import { scanPageForTotp, findOtpauthInText, decodeQrOnPage } from './qr-scan.js';

const api = globalThis.chrome ?? globalThis.browser;

/**
 * Cross-origin iframes are a standard credential-exfiltration route: a page
 * embeds a frame it controls and harvests whatever autofill puts into it.
 * Filling there would need an explicit per-site opt-in, which does not exist
 * yet, so for now it simply never happens.
 */
function isSafeFrame() {
  if (window.top === window.self) {
    return true;
  }
  try {
    // Throws for a cross-origin parent — which is the answer we want.
    return window.top.location.origin === window.location.origin;
  } catch {
    return false;
  }
}

async function send(type, payload) {
  const response = await api.runtime.sendMessage({ type, payload });
  if (response === undefined || !response.ok) {
    throw new Error(response?.error?.message ?? 'no response from KeyVault');
  }
  return response.data;
}

/** The credential the user last submitted, awaiting a save decision. */
let pendingSubmission = null;

/** A human name for the current site, used as the item's default title. */
function siteLabel() {
  const host = window.location.hostname.replace(/^www\./, '');
  const title = document.title.trim();
  // The document title is usually more meaningful than the hostname, but it
  // is often the whole page heading, so it is trimmed to something usable.
  return title === '' ? host : title.slice(0, 60);
}

/**
 * Fill the page's login form with a specific saved entry.
 *
 * @param {string} entryId
 */
async function fillWith(entryId) {
  const targets = detectLoginForms(document).filter((target) => target.kind === 'login');
  if (targets.length === 0) {
    return { filled: false, reason: 'no login form found' };
  }

  // The background re-validates that this entry belongs to this origin and
  // refuses otherwise, so a compromised page cannot name an arbitrary id.
  const credential = await send('credentials/fill', { id: entryId, url: window.location.href });

  const target = targets[0];
  const result = fillCredential(target, credential);

  // Auto-submit only when this specific entry opted in. The flag comes from
  // the background, not from anything decided here.
  if (result.filledPassword && credential.autoSubmit === true) {
    submitForm(target);
  }
  return { filled: result.filledPassword || result.filledUsername };
}

/**
 * Capture what was typed, so it can be offered for saving.
 *
 * Read at submit time because single-page apps tear the form down
 * immediately afterwards, and a full page load destroys it outright.
 */
function captureSubmission() {
  const [target] = detectLoginForms(document);
  if (target === undefined || target.password === null) {
    return;
  }
  const password = target.password.value;
  if (password === '') {
    return;
  }
  pendingSubmission = {
    username: target.username?.value ?? '',
    password,
    url: window.location.href,
    title: siteLabel(),
  };
}

/**
 * Offer to save a captured credential.
 *
 * @param {object} submission
 */
async function offerToSave(submission) {
  if (submission === null || submission === undefined) {
    return;
  }

  let known = [];
  try {
    ({ entries: known } = await send('credentials/forUrl', { url: submission.url }));
  } catch {
    // Locked vault, or the background is asleep. Saying nothing is right: a
    // prompt that cannot complete would only confuse.
    return;
  }

  const { worthSaving, isUpdate } = shouldOfferToSave(submission, known);
  if (!worthSaving) {
    return;
  }

  const choice = await showSavePrompt({
    title: submission.title,
    site: submission.url,
    username: submission.username,
    password: submission.password,
    isUpdate,
    // A two-step setup page shows the login form and the 2FA QR together.
    // Offering both in one prompt is the difference between having
    // two-factor set up and meaning to.
    totpUri: submission.totpUri ?? (await findTotpOnThisPage()),
  });
  if (choice.action !== 'save') {
    return;
  }

  // The values from the prompt, not the captured ones: the user may have
  // corrected a mis-detected field before saving.
  await send('credentials/save', {
    url: submission.url,
    title: choice.title,
    username: choice.username,
    password: choice.password,
    totpUri: choice.totpUri ?? undefined,
  });
}

/**
 * A two-factor secret on this page, if one can be read here.
 *
 * Only the strategies the content script can complete on its own: printed
 * text, and native `BarcodeDetector` where the browser has it. The bundled
 * image decoder lives in the extension's own page, so a QR that needs it is
 * left for the vault's Scan action rather than blocking this prompt.
 *
 * @returns {Promise<string|null>}
 */
async function findTotpOnThisPage() {
  try {
    const inText = findOtpauthInText(document);
    if (inText !== null) {
      return inText.uri;
    }
    const inImage = await decodeQrOnPage(document);
    return inImage?.uri ?? null;
  } catch {
    return null;
  }
}

/**
 * Hand a capture to the background so it survives the page unloading.
 *
 * A normal form POST unloads this script along with everything it holds.
 * Without this the save prompt only ever worked on single-page apps.
 */
function stashBeforeUnload() {
  if (pendingSubmission === null) {
    return;
  }
  api.runtime.sendMessage({ type: 'credentials/stash', payload: pendingSubmission }).catch(() => {
    // The page is going away; there is nothing left to recover to.
  });
  pendingSubmission = null;
}

/** On load, collect anything stashed by the page that navigated here. */
async function collectStashed() {
  try {
    const { pending } = await send('credentials/pending', { url: window.location.href });
    if (pending !== null) {
      await offerToSave(pending);
    }
  } catch {
    // Vault locked, or nothing waiting.
  }
}

function start() {
  if (!isSafeFrame()) {
    return;
  }

  // Submit is the reliable capture point; a click on the submit button also
  // covers apps that never fire a real submit event.
  document.addEventListener('submit', captureSubmission, true);
  document.addEventListener(
    'click',
    (event) => {
      const button = event.target?.closest?.('button, input[type="submit"]');
      if (button !== null && button !== undefined) {
        captureSubmission();
      }
    },
    true,
  );

  // Covers a full navigation: hand the capture to the background first.
  window.addEventListener('pagehide', stashBeforeUnload);
  window.addEventListener('beforeunload', stashBeforeUnload);

  // Covers a single-page app: the URL changes without a page load, so the
  // capture is still here and can be offered directly.
  let lastUrl = window.location.href;
  const observer = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      const submission = pendingSubmission;
      pendingSubmission = null;
      offerToSave(submission);
    }
  });
  observer.observe(document, { subtree: true, childList: true });

  api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'content/fill') {
      fillWith(message.payload.id)
        .then(sendResponse)
        .catch((error) => sendResponse({ filled: false, reason: error.message }));
      return true;
    }
    if (message?.type === 'content/scanTotp') {
      // Reads only this page, and only when the user asked for it from the
      // extension's own UI.
      scanPageForTotp(document)
        .then(sendResponse)
        .catch((error) => sendResponse({ found: false, reason: error.message }));
      return true;
    }
    if (message?.type === 'content/dismiss') {
      dismissSavePrompt();
    }
    return false;
  });

  collectStashed();
}

start();
