/**
 * Writing a value into a page's input so the page actually notices.
 *
 * The single most common autofill bug lives here. Assigning `input.value = x`
 * updates the DOM but does **not** notify React, Vue, Angular, Svelte or any
 * other framework that tracks state separately: the box looks filled, the
 * user clicks submit, and the app sends an empty string. Users report this as
 * "the password manager typed nothing".
 *
 * The fix is to call the *native* value setter — bypassing the property React
 * installs on the element to intercept writes — and then dispatch the events
 * a real keystroke would produce.
 */

/**
 * Cached native setters. Read from the prototype once, before any page script
 * has a chance to replace them on an instance.
 */
const nativeSetters = new Map();

function nativeValueSetter(element) {
  const proto = Object.getPrototypeOf(element);
  if (!nativeSetters.has(proto)) {
    nativeSetters.set(proto, Object.getOwnPropertyDescriptor(proto, 'value')?.set ?? null);
  }
  return nativeSetters.get(proto);
}

/**
 * Set a field's value in a way frameworks observe.
 *
 * @param {HTMLInputElement|HTMLTextAreaElement} element
 * @param {string} value
 * @returns {boolean} whether the value took
 */
export function setFieldValue(element, value) {
  if (element === null || element === undefined) {
    return false;
  }

  const setter = nativeValueSetter(element);
  if (setter !== null) {
    setter.call(element, value);
  } else {
    // No native descriptor (an exotic element, or a hostile page). Better a
    // plain assignment than nothing.
    element.value = value;
  }

  // `input` drives React's onChange and Vue's v-model; `change` drives
  // classic listeners and blur-time validation. Both must bubble, because
  // frameworks listen at the root, not on the element.
  element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

  return element.value === value;
}

/**
 * Fill a detected form.
 *
 * Returns what was filled rather than a bare boolean, so the caller can tell
 * a partial fill — username only, on a two-step login — from a failure.
 *
 * @param {{username: HTMLInputElement|null, password: HTMLInputElement|null}} target
 * @param {{username?: string, password?: string}} credential
 * @returns {{filledUsername: boolean, filledPassword: boolean}}
 */
export function fillCredential(target, credential) {
  const filledUsername =
    target.username !== null &&
    typeof credential.username === 'string' &&
    credential.username !== '' &&
    setFieldValue(target.username, credential.username);

  const filledPassword =
    target.password !== null &&
    typeof credential.password === 'string' &&
    credential.password !== '' &&
    setFieldValue(target.password, credential.password);

  // Focus the password box so the user's next keystroke or Enter lands
  // somewhere sensible, without submitting anything.
  if (filledPassword) {
    target.password.focus?.();
  } else if (filledUsername) {
    target.username.focus?.();
  }

  return { filledUsername, filledPassword };
}

/**
 * Type a one-time code into whatever shape the page uses.
 *
 * A row of single-character boxes needs the digits distributed one per box,
 * each with its own events — filling the first box with all six digits is
 * what happens otherwise, and the site rejects it.
 *
 * Each box is focused before it is written to, because these components
 * usually advance focus themselves on input, and writing to a box the
 * component thinks is not active is ignored.
 *
 * @param {{fields: HTMLInputElement[], split: boolean}} target
 * @param {string} code
 * @returns {boolean}
 */
export function fillOtpCode(target, code) {
  if (target === null || target === undefined || code === '') {
    return false;
  }

  if (!target.split) {
    const [field] = target.fields;
    field?.focus?.();
    return setFieldValue(field, code);
  }

  const digits = [...code];
  if (digits.length > target.fields.length) {
    return false;
  }

  digits.forEach((digit, index) => {
    const field = target.fields[index];
    field?.focus?.();
    setFieldValue(field, digit);
  });

  // Blur the last box so validation that runs on blur fires.
  target.fields[digits.length - 1]?.blur?.();
  return target.fields[0].value !== '';
}

/**
 * Submit the page a one-time code was typed into.
 *
 * Verification pages often render the boxes outside any `<form>`, so the
 * enclosing form is tried first and then the nearest plausible submit
 * button — searched from the field outwards, since a page header may hold
 * unrelated buttons.
 *
 * @param {{fields: HTMLInputElement[]}} target
 * @returns {boolean}
 */
export function submitOtp(target) {
  const anchor = target?.fields?.[0];
  if (anchor === null || anchor === undefined) {
    return false;
  }

  const form = anchor.form;
  if (form !== null && form !== undefined) {
    return submitForm({ form });
  }

  // Walk outwards, taking the first enabled submit-looking button. Starting
  // at the field keeps an unrelated header button from winning.
  let scope = anchor.parentElement;
  while (scope !== null && scope !== anchor.ownerDocument.body) {
    const button = [...scope.querySelectorAll('button, input[type="submit"]')].find(
      (candidate) =>
        !candidate.disabled &&
        (candidate.type === 'submit' ||
          /verify|submit|continue|confirm|sign\s*in/i.test(candidate.textContent ?? '')),
    );
    if (button !== undefined) {
      button.click();
      return true;
    }
    scope = scope.parentElement;
  }
  return false;
}

/**
 * Submit a filled login form.
 *
 * Only ever called when the specific credential opted in — auto-submit is
 * per-entry and off by default, because a look-alike domain or an injected
 * form otherwise harvests the credential before the user can react. The
 * origin check happens in the background before the password is released;
 * by the time this runs, that decision has already been made.
 *
 * Prefers clicking the real submit button over `form.submit()`: the latter
 * bypasses `onsubmit` handlers and native validation entirely, which breaks
 * most single-page apps.
 *
 * @param {{form: Element|null, password: HTMLInputElement|null}} target
 * @returns {boolean} whether a submission was triggered
 */
export function submitForm(target) {
  const form = target.form;
  if (form === null || form === undefined) {
    return false;
  }

  const button = form.querySelector(
    'button[type="submit"], input[type="submit"], button:not([type])',
  );
  if (button !== null && !button.disabled) {
    button.click();
    return true;
  }

  if (typeof form.requestSubmit === 'function') {
    form.requestSubmit();
    return true;
  }
  return false;
}
