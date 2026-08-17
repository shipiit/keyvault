/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setFieldValue,
  fillCredential,
  submitForm,
  fillOtpCode,
  submitOtp,
} from '../../src/content/filler.js';
import { detectLoginForms, detectOtpFields } from '../../src/content/field-detector.js';

function mount(html) {
  document.body.innerHTML = html;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('setFieldValue', () => {
  it('writes the value', () => {
    mount('<input id="a" />');
    const input = document.getElementById('a');
    expect(setFieldValue(input, 'hello')).toBe(true);
    expect(input.value).toBe('hello');
  });

  it('dispatches bubbling input and change events', () => {
    // Frameworks listen at the document root, not on the element, so a
    // non-bubbling event reaches nothing.
    mount('<form><input id="a" /></form>');
    const input = document.getElementById('a');
    const seen = [];
    document.addEventListener('input', (e) => seen.push(['input', e.bubbles]));
    document.addEventListener('change', (e) => seen.push(['change', e.bubbles]));

    setFieldValue(input, 'x');

    expect(seen).toEqual([
      ['input', true],
      ['change', true],
    ]);
  });

  it('notifies a framework that intercepts the value property', () => {
    // This is the bug the module exists for. React installs its own `value`
    // setter on the element instance to track state. A plain
    // `input.value = x` hits that shim, the DOM updates, but React's state
    // does not — so the app submits an empty string and the user reports
    // "the password manager typed nothing".
    mount('<input id="a" />');
    const input = document.getElementById('a');

    let frameworkState = '';
    let shimSawWrite = false;
    const nativeDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

    // Stand in for React's instance-level interception.
    Object.defineProperty(input, 'value', {
      configurable: true,
      get() {
        return nativeDescriptor.get.call(this);
      },
      set(next) {
        shimSawWrite = true;
        nativeDescriptor.set.call(this, next);
      },
    });
    input.addEventListener('input', (e) => {
      frameworkState = e.target.value;
    });

    setFieldValue(input, 'S3cr3t!');

    // The native setter is used, so the interception shim is bypassed...
    expect(shimSawWrite).toBe(false);
    // ...and the framework still learns the value, via the dispatched event.
    expect(frameworkState).toBe('S3cr3t!');
    expect(input.value).toBe('S3cr3t!');
  });

  it('returns false for a null element rather than throwing', () => {
    expect(setFieldValue(null, 'x')).toBe(false);
  });

  it('fills a textarea as well as an input', () => {
    mount('<textarea id="t"></textarea>');
    expect(setFieldValue(document.getElementById('t'), 'note')).toBe(true);
    expect(document.getElementById('t').value).toBe('note');
  });
});

describe('fillCredential', () => {
  it('fills both fields and reports what happened', () => {
    mount('<form><input name="u" /><input type="password" name="p" /></form>');
    const [target] = detectLoginForms(document);

    const result = fillCredential(target, { username: 'rahul', password: 'S3cr3t!' });

    expect(result).toEqual({ filledUsername: true, filledPassword: true });
    expect(target.username.value).toBe('rahul');
    expect(target.password.value).toBe('S3cr3t!');
  });

  it('reports a partial fill on a two-step login', () => {
    // Distinguishing partial from failed matters: the caller should not
    // report an error when the username step succeeded.
    mount('<form><input type="email" autocomplete="username" /></form>');
    const [target] = detectLoginForms(document);

    const result = fillCredential(target, { username: 'rahul', password: 'S3cr3t!' });

    expect(result).toEqual({ filledUsername: true, filledPassword: false });
  });

  it('skips empty values rather than clearing the field', () => {
    mount('<form><input name="u" value="existing" /><input type="password" name="p" /></form>');
    const [target] = detectLoginForms(document);

    const result = fillCredential(target, { username: '', password: 'S3cr3t!' });

    expect(result.filledUsername).toBe(false);
    expect(target.username.value).toBe('existing');
  });

  it('focuses the password field so the next keystroke lands sensibly', () => {
    mount('<form><input name="u" /><input type="password" name="p" /></form>');
    const [target] = detectLoginForms(document);

    fillCredential(target, { username: 'rahul', password: 'S3cr3t!' });

    expect(document.activeElement).toBe(target.password);
  });

  it('does not submit anything by itself', () => {
    // Filling and submitting are separate steps. Auto-submit is per-entry
    // and opt-in, so fill alone must never trigger it.
    mount('<form><input name="u" /><input type="password" name="p" /></form>');
    const submitted = vi.fn((e) => e.preventDefault());
    document.querySelector('form').addEventListener('submit', submitted);

    fillCredential(detectLoginForms(document)[0], { username: 'u', password: 'p' });

    expect(submitted).not.toHaveBeenCalled();
  });
});

describe('detectOtpFields', () => {
  it('finds a row of single-character boxes', () => {
    // The shape a two-step page actually uses. Treating it as one field
    // puts all six digits in the first box and the site rejects it.
    mount(Array.from({ length: 6 }, () => '<input maxlength="1" type="text">').join(''));
    const target = detectOtpFields(document);
    expect(target.split).toBe(true);
    expect(target.fields).toHaveLength(6);
  });

  it('finds a single field marked one-time-code', () => {
    mount('<input autocomplete="one-time-code" id="c">');
    const target = detectOtpFields(document);
    expect(target.split).toBe(false);
    expect(target.fields[0].id).toBe('c');
  });

  it('infers a single field from its name', () => {
    mount('<input name="verification_code" maxlength="6" id="c">');
    expect(detectOtpFields(document).fields[0].id).toBe('c');
  });

  it('does not mistake a search box named code for a code entry', () => {
    mount('<input name="coupon_code" type="search">');
    expect(detectOtpFields(document)).toBeNull();
  });

  it('does not mistake a password field for a code', () => {
    mount('<input type="password" name="otp">');
    expect(detectOtpFields(document)).toBeNull();
  });

  it('returns null on a page with no code entry', () => {
    mount('<input type="text" name="search">');
    expect(detectOtpFields(document)).toBeNull();
  });

  it('ignores a lone single-character box, which is not a code row', () => {
    mount('<input maxlength="1">');
    expect(detectOtpFields(document)).toBeNull();
  });
});

describe('fillOtpCode', () => {
  it('spreads one digit per box', () => {
    mount(Array.from({ length: 6 }, (_, i) => `<input maxlength="1" id="b${i}">`).join(''));
    const target = detectOtpFields(document);

    expect(fillOtpCode(target, '049779')).toBe(true);
    expect([...'012345'].map((i) => document.getElementById(`b${i}`).value)).toEqual([
      '0',
      '4',
      '9',
      '7',
      '7',
      '9',
    ]);
  });

  it('notifies the page for every box, not just the first', () => {
    // These components advance focus themselves on input; a box written to
    // without an event is a box the component does not know about.
    mount(Array.from({ length: 6 }, () => '<input maxlength="1">').join(''));
    const seen = [];
    document.addEventListener('input', (event) => seen.push(event.target.value));

    fillOtpCode(detectOtpFields(document), '049779');
    expect(seen).toEqual(['0', '4', '9', '7', '7', '9']);
  });

  it('fills a single field in one go', () => {
    mount('<input autocomplete="one-time-code" id="c">');
    fillOtpCode(detectOtpFields(document), '049779');
    expect(document.getElementById('c').value).toBe('049779');
  });

  it('refuses a code longer than the row', () => {
    mount(Array.from({ length: 4 }, () => '<input maxlength="1">').join(''));
    expect(fillOtpCode(detectOtpFields(document), '049779')).toBe(false);
  });

  it('does nothing with an empty code or no target', () => {
    expect(fillOtpCode(null, '049779')).toBe(false);
    mount('<input autocomplete="one-time-code">');
    expect(fillOtpCode(detectOtpFields(document), '')).toBe(false);
  });
});

describe('submitOtp', () => {
  const boxes = (count = 6) =>
    Array.from({ length: count }, () => '<input maxlength="1">').join('');

  it('submits the enclosing form when there is one', () => {
    mount(`<form>${boxes()}<button type="submit" id="go">Verify</button></form>`);
    const clicked = vi.fn();
    document.getElementById('go').addEventListener('click', clicked);

    expect(submitOtp(detectOtpFields(document))).toBe(true);
    expect(clicked).toHaveBeenCalledOnce();
  });

  it('finds the button when the boxes are not inside a form', () => {
    // Verification pages routinely render the boxes outside any <form>.
    mount(`<div>${boxes()}<button id="go">Verify</button></div>`);
    const clicked = vi.fn();
    document.getElementById('go').addEventListener('click', clicked);

    expect(submitOtp(detectOtpFields(document))).toBe(true);
    expect(clicked).toHaveBeenCalledOnce();
  });

  it('prefers a button near the boxes over one elsewhere on the page', () => {
    mount(`
      <header><button id="away">Sign out</button></header>
      <div id="panel">${boxes()}<button id="go">Verify</button></div>
    `);
    const near = vi.fn();
    const far = vi.fn();
    document.getElementById('go').addEventListener('click', near);
    document.getElementById('away').addEventListener('click', far);

    submitOtp(detectOtpFields(document));
    expect(near).toHaveBeenCalledOnce();
    expect(far).not.toHaveBeenCalled();
  });

  it('ignores a disabled button rather than clicking nothing', () => {
    mount(`<div>${boxes()}<button id="go" disabled>Verify</button></div>`);
    const clicked = vi.fn();
    document.getElementById('go').addEventListener('click', clicked);

    expect(submitOtp(detectOtpFields(document))).toBe(false);
    expect(clicked).not.toHaveBeenCalled();
  });

  it('reports failure when there is nothing to submit', () => {
    mount(`<div>${boxes()}</div>`);
    expect(submitOtp(detectOtpFields(document))).toBe(false);
    expect(submitOtp(null)).toBe(false);
  });
});

describe('submitForm', () => {
  it('clicks the real submit button rather than calling form.submit()', () => {
    // form.submit() bypasses onsubmit handlers and native validation, which
    // breaks most single-page apps.
    mount(`
      <form>
        <input name="u" /><input type="password" name="p" />
        <button type="submit" id="go">Sign in</button>
      </form>
    `);
    const clicked = vi.fn();
    document.getElementById('go').addEventListener('click', clicked);

    expect(submitForm(detectLoginForms(document)[0])).toBe(true);
    expect(clicked).toHaveBeenCalledOnce();
  });

  it('treats an untyped button as the submit button', () => {
    mount(`
      <form>
        <input name="u" /><input type="password" name="p" />
        <button id="go">Continue</button>
      </form>
    `);
    const clicked = vi.fn();
    document.getElementById('go').addEventListener('click', clicked);

    submitForm(detectLoginForms(document)[0]);
    expect(clicked).toHaveBeenCalledOnce();
  });

  it('ignores a disabled submit button and falls back to requestSubmit', () => {
    mount(`
      <form>
        <input name="u" /><input type="password" name="p" />
        <button type="submit" id="go" disabled>Sign in</button>
      </form>
    `);
    const form = document.querySelector('form');
    form.requestSubmit = vi.fn();
    const clicked = vi.fn();
    document.getElementById('go').addEventListener('click', clicked);

    expect(submitForm(detectLoginForms(document)[0])).toBe(true);
    expect(clicked).not.toHaveBeenCalled();
    expect(form.requestSubmit).toHaveBeenCalledOnce();
  });

  it('reports failure when there is no form to submit', () => {
    mount('<div><input name="u" /><input type="password" name="p" /></div>');
    expect(submitForm({ form: null, password: null })).toBe(false);
  });
});
