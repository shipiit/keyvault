/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setFieldValue, fillCredential, submitForm } from '../../src/content/filler.js';
import { detectLoginForms } from '../../src/content/field-detector.js';

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
