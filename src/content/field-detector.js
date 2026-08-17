/**
 * Finding the username and password fields on an arbitrary page.
 *
 * There is no standard every site follows, so this scores candidates rather
 * than pattern-matching one shape. The ranking is deliberate:
 *
 *   1. `autocomplete` — the only signal a site states on purpose. Trusted most.
 *   2. `type` — reliable for passwords, weak for usernames.
 *   3. `name` / `id` — usually meaningful, occasionally obfuscated.
 *   4. `placeholder` / `aria-label` / label text — human-facing, so
 *      localised and least reliable.
 *
 * Everything here is a pure function of a DOM subtree: no Chrome APIs, no
 * network, no message passing. That keeps it testable against real HTML.
 */

const USERNAME_HINTS =
  /(user|login|email|e-mail|account|identifi|handle|nick|signin|benutzer|correo|usuario|utilisateur)/i;

/** Fields that look like a username but are not one. */
const USERNAME_ANTI_HINTS = /(search|query|coupon|promo|discount|zip|postal|phone|otp|code|token)/i;

const NEW_PASSWORD_HINTS = /(new|confirm|repeat|retype|again|verify|register|signup|sign-up)/i;

/** Inputs that can never hold a username. */
const IGNORED_TYPES = new Set([
  'hidden',
  'submit',
  'button',
  'reset',
  'image',
  'file',
  'checkbox',
  'radio',
  'range',
  'color',
]);

/**
 * Text a human would associate with this field.
 *
 * @param {HTMLInputElement} input
 * @returns {string}
 */
function labelTextFor(input) {
  const parts = [input.getAttribute('aria-label') ?? '', input.placeholder ?? ''];

  // `labels` is the native association list — it covers both `for=` and
  // wrapping labels, and needs no selector escaping, which matters because
  // ids in the wild contain characters that break a naive attribute selector.
  for (const label of input.labels ?? []) {
    parts.push(label.textContent ?? '');
  }
  parts.push(input.closest?.('label')?.textContent ?? '');

  const describedBy = input.getAttribute('aria-labelledby');
  if (describedBy !== null) {
    for (const id of describedBy.split(/\s+/)) {
      parts.push(input.ownerDocument.getElementById(id)?.textContent ?? '');
    }
  }
  return parts.join(' ').trim();
}

/**
 * Whether a field is genuinely fillable — visible, enabled, and writable.
 *
 * Sites routinely keep decoy or off-screen inputs in the DOM; filling one
 * puts a credential somewhere the user cannot see.
 *
 * @param {HTMLInputElement} input
 * @returns {boolean}
 */
export function isFillable(input) {
  if (input.disabled || input.readOnly) {
    return false;
  }
  if (IGNORED_TYPES.has((input.type ?? '').toLowerCase())) {
    return false;
  }
  if (input.getAttribute('aria-hidden') === 'true') {
    return false;
  }

  // jsdom does not lay out, so offsetParent is unusable in tests. Explicit
  // hiding is what matters in practice anyway.
  const style = input.ownerDocument.defaultView?.getComputedStyle?.(input);
  if (style !== undefined && style !== null) {
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
  }
  return true;
}

/**
 * @param {HTMLInputElement} input
 * @returns {boolean}
 */
export function isPasswordField(input) {
  if ((input.type ?? '').toLowerCase() === 'password') {
    return true;
  }
  // Some sites swap type to "text" to implement their own reveal toggle.
  const autocomplete = (input.autocomplete ?? '').toLowerCase();
  return autocomplete.includes('current-password') || autocomplete.includes('new-password');
}

/**
 * Score a field's likelihood of being the username, 0 upward.
 *
 * @param {HTMLInputElement} input
 * @returns {number}
 */
export function scoreUsernameField(input) {
  const autocomplete = (input.autocomplete ?? '').toLowerCase();
  const type = (input.type ?? 'text').toLowerCase();
  const attrs = `${input.name ?? ''} ${input.id ?? ''}`;
  const human = labelTextFor(input);

  // Stated intent beats every heuristic below it.
  if (autocomplete === 'username' || autocomplete === 'email') {
    return 100;
  }
  if (autocomplete === 'off' || autocomplete === 'new-password') {
    return 0;
  }

  let score = 0;
  if (type === 'email') score += 40;
  else if (type === 'text' || type === 'tel') score += 10;
  else return 0;

  if (USERNAME_HINTS.test(attrs)) score += 30;
  if (USERNAME_HINTS.test(human)) score += 15;
  if (USERNAME_ANTI_HINTS.test(attrs) || USERNAME_ANTI_HINTS.test(human)) score -= 50;

  return Math.max(0, score);
}

/**
 * Classify what a password field is for.
 *
 * Filling a saved password into a "new password" box on a change-password
 * form would silently reset the account to the old value, so the distinction
 * has to be made before anything is filled.
 *
 * @param {HTMLInputElement} input
 * @returns {'current'|'new'}
 */
export function classifyPasswordField(input) {
  const autocomplete = (input.autocomplete ?? '').toLowerCase();
  if (autocomplete.includes('new-password')) return 'new';
  if (autocomplete.includes('current-password')) return 'current';

  const text = `${input.name ?? ''} ${input.id ?? ''} ${labelTextFor(input)}`;
  return NEW_PASSWORD_HINTS.test(text) ? 'new' : 'current';
}

/**
 * Find the login form or forms in a document or subtree.
 *
 * @param {Document|Element} root
 * @returns {Array<{form: Element|null, username: HTMLInputElement|null,
 *                  password: HTMLInputElement|null, kind: 'login'|'signup'|'change'}>}
 */
export function detectLoginForms(root) {
  const inputs = collectInputs(root).filter(isFillable);
  const passwords = inputs.filter(isPasswordField);

  if (passwords.length === 0) {
    // A username field with no password is the first step of a two-page
    // login. Worth reporting so the username can still be filled.
    const candidates = inputs
      .map((input) => ({ input, score: scoreUsernameField(input) }))
      .filter(({ score }) => score >= 70);
    return candidates.length === 1
      ? [
          {
            form: candidates[0].input.form,
            username: candidates[0].input,
            password: null,
            kind: 'login',
          },
        ]
      : [];
  }

  const groups = new Map();
  for (const password of passwords) {
    const scope = password.form ?? root;
    if (!groups.has(scope)) {
      groups.set(scope, []);
    }
    groups.get(scope).push(password);
  }

  return [...groups.entries()].map(([scope, groupPasswords]) => {
    const kinds = groupPasswords.map(classifyPasswordField);
    const newCount = kinds.filter((k) => k === 'new').length;

    // Two or more password boxes means "new + confirm": a signup or a
    // change-password form, never a plain login.
    const kind =
      groupPasswords.length > 1 || newCount > 0
        ? groupPasswords.length > 1 && kinds.includes('current')
          ? 'change'
          : 'signup'
        : 'login';

    const target =
      kind === 'login'
        ? groupPasswords[0]
        : (groupPasswords.find((p) => classifyPasswordField(p) === 'new') ?? groupPasswords[0]);

    return {
      form: scope instanceof Element ? scope : null,
      username: findUsernameFor(target, scope),
      password: target,
      kind,
    };
  });
}

/**
 * The best username candidate for a given password field.
 *
 * Restricted to fields *before* the password in document order: a field after
 * it is far more likely to be "confirm password" or an unrelated control.
 *
 * @param {HTMLInputElement} password
 * @param {Element|Document} scope
 * @returns {HTMLInputElement|null}
 */
export function findUsernameFor(password, scope) {
  const candidates = collectInputs(scope)
    .filter((input) => isFillable(input) && !isPasswordField(input))
    .filter((input) => password.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_PRECEDING)
    .map((input) => ({ input, score: scoreUsernameField(input) }))
    .filter(({ score }) => score > 0);

  if (candidates.length === 0) {
    return null;
  }
  // Ties go to the field nearest the password box.
  return candidates.reduce((best, current) => (current.score >= best.score ? current : best)).input;
}

/** Names and labels that mark a one-time-code field. */
const OTP_HINTS =
  /(one.?time|otp\b|2fa|two.?factor|verification|verify|auth.?code|security.?code|token|mfa)/i;

/**
 * Find the one-time-code entry on a page.
 *
 * Two shapes cover almost everything:
 *
 *  - **One field.** Usually marked `autocomplete="one-time-code"`, which is
 *    the standard and the only signal a site states deliberately.
 *  - **A row of single-character boxes.** Visually nicer, and the reason a
 *    naive "fill the first input" approach puts all six digits in box one.
 *
 * Returns the fields in document order, so the caller can distribute digits
 * across them.
 *
 * @param {Document|Element} root
 * @returns {{fields: HTMLInputElement[], split: boolean}|null}
 */
export function detectOtpFields(root) {
  const inputs = collectInputs(root).filter(
    (input) => isFillable(input) && !isPasswordField(input),
  );

  // A row of short boxes. Checked first: such a page often labels only the
  // group, so the individual inputs carry no useful name.
  const boxes = inputs.filter((input) => {
    const maxLength = Number(input.getAttribute('maxlength'));
    const type = (input.type ?? 'text').toLowerCase();
    return (
      maxLength === 1 &&
      (type === 'text' || type === 'tel' || type === 'number' || type === 'password')
    );
  });
  if (boxes.length >= 4 && boxes.length <= 10) {
    return { fields: boxes, split: true };
  }

  // A single field, stated outright.
  const declared = inputs.find((input) =>
    (input.autocomplete ?? '').toLowerCase().includes('one-time-code'),
  );
  if (declared !== undefined) {
    return { fields: [declared], split: false };
  }

  // A single field, inferred. Length limits are checked so a search box
  // named "code" is not mistaken for a code entry.
  const named = inputs.find((input) => {
    const text = `${input.name ?? ''} ${input.id ?? ''} ${input.placeholder ?? ''} ${
      input.getAttribute('aria-label') ?? ''
    }`;
    if (!OTP_HINTS.test(text)) {
      return false;
    }
    const maxLength = Number(input.getAttribute('maxlength'));
    return Number.isNaN(maxLength) || (maxLength >= 4 && maxLength <= 10);
  });

  return named === undefined ? null : { fields: [named], split: false };
}

/**
 * All inputs under a root, including those inside open shadow roots.
 *
 * Design-system components routinely wrap inputs in a shadow root, and an
 * autofill that stops at the shadow boundary silently does nothing on them.
 *
 * @param {Document|Element} root
 * @returns {HTMLInputElement[]}
 */
export function collectInputs(root) {
  const found = [];
  const visit = (node) => {
    if (node === null || node === undefined) return;
    for (const element of node.querySelectorAll?.('input') ?? []) {
      found.push(element);
    }
    for (const element of node.querySelectorAll?.('*') ?? []) {
      if (element.shadowRoot !== null && element.shadowRoot !== undefined) {
        visit(element.shadowRoot);
      }
    }
  };
  visit(root);
  return found;
}
