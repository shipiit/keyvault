/**
 * Content script.
 *
 * Runs inside every page the user visits, which makes it the least trusted
 * code in the extension. It deliberately holds no secrets and can ask the
 * background for only two things:
 *
 *   - which saved entries match this page (metadata, never a password)
 *   - one specific credential, for this page, at the moment of a fill
 *
 * It cannot enumerate the vault, cannot read the encryption key, and cannot
 * unlock anything. The background re-checks the origin before releasing a
 * password, so nothing here is trusted to have got that right.
 */

import { detectLoginForms } from './field-detector.js';
import { fillCredential, submitForm } from './filler.js';
import { showSavePrompt, dismissSavePrompt, shouldOfferToSave } from './save-prompt.js';

const api = globalThis.chrome ?? globalThis.browser;

/**
 * Cross-origin iframes are a standard credential-exfiltration route: a page
 * embeds a frame it controls and harvests whatever autofill puts into it.
 * Filling there requires an explicit per-site opt-in, which does not exist
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

/** The last credential the user submitted, awaiting a save decision. */
let pendingSubmission = null;

/**
 * Fill the page's login form with a specific saved entry.
 *
 * @param {string} entryId
 */
async function fillWith(entryId) {
  const targets = detectLoginForms(document).filter((t) => t.kind === 'login');
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
 * Capture what was typed, so it can be offered for saving after the login
 * completes. Reading the field at submit time is the only reliable moment:
 * single-page apps tear the form down immediately afterwards.
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
    title: document.title || window.location.hostname,
    kind: target.kind,
  };
}

/**
 * Offer to save, once the submission looks like it succeeded.
 */
async function offerToSave() {
  const submission = pendingSubmission;
  pendingSubmission = null;
  if (submission === null) {
    return;
  }

  let known = [];
  try {
    ({ entries: known } = await send('credentials/forUrl', { url: submission.url }));
  } catch {
    // Locked vault, or the background is asleep. Saying nothing is right:
    // a prompt that cannot complete would just confuse.
    return;
  }

  const { worthSaving, isUpdate } = shouldOfferToSave(submission, known);
  if (!worthSaving) {
    return;
  }

  const choice = await showSavePrompt({
    title: submission.title,
    username: submission.username,
    isUpdate,
  });
  if (choice !== 'save') {
    return;
  }

  await send('credentials/save', {
    url: submission.url,
    title: submission.title,
    username: submission.username,
    password: submission.password,
  });
}

function start() {
  if (!isSafeFrame()) {
    return;
  }

  // Submit is the reliable capture point; a click on the submit button covers
  // single-page apps that never fire a real submit event.
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

  // A navigation or a URL change after a captured submission is the signal
  // that the login went through.
  window.addEventListener('pagehide', () => {
    if (pendingSubmission !== null) {
      // The page is going away; hand the capture to the background so the
      // offer survives the navigation.
      api.runtime
        .sendMessage({ type: 'credentials/stash', payload: pendingSubmission })
        .catch(() => {});
    }
  });

  let lastUrl = window.location.href;
  const observer = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      offerToSave();
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
    if (message?.type === 'content/dismiss') {
      dismissSavePrompt();
    }
    return false;
  });
}

start();
