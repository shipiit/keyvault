/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  detectLoginForms,
  scoreUsernameField,
  classifyPasswordField,
  isPasswordField,
  isFillable,
  collectInputs,
} from '../../src/content/field-detector.js';

function mount(html) {
  document.body.innerHTML = html;
  return document.body;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('detectLoginForms — real-world shapes', () => {
  it('finds a plain login form', () => {
    mount(`
      <form>
        <input name="username" type="text" />
        <input name="password" type="password" />
        <button type="submit">Sign in</button>
      </form>
    `);
    const [detected] = detectLoginForms(document);
    expect(detected.kind).toBe('login');
    expect(detected.username.name).toBe('username');
    expect(detected.password.name).toBe('password');
  });

  it('finds an email-based login', () => {
    mount(`
      <form>
        <input type="email" id="email" autocomplete="username" />
        <input type="password" autocomplete="current-password" />
      </form>
    `);
    const [detected] = detectLoginForms(document);
    expect(detected.username.id).toBe('email');
    expect(detected.kind).toBe('login');
  });

  it('classifies a signup form, so a saved password is not filled into it', () => {
    // Filling here would put the old password into a new-account form.
    mount(`
      <form>
        <input type="email" name="email" />
        <input type="password" autocomplete="new-password" name="password" />
        <input type="password" autocomplete="new-password" name="confirm" />
      </form>
    `);
    expect(detectLoginForms(document)[0].kind).toBe('signup');
  });

  it('classifies a change-password form', () => {
    // The dangerous one: filling the saved password into "new password"
    // would silently reset the account back to its old value.
    mount(`
      <form>
        <input type="password" autocomplete="current-password" name="old" />
        <input type="password" autocomplete="new-password" name="new" />
        <input type="password" autocomplete="new-password" name="confirm" />
      </form>
    `);
    expect(detectLoginForms(document)[0].kind).toBe('change');
  });

  it('handles a two-step login where only the username is shown', () => {
    mount('<form><input type="email" autocomplete="username" id="u" /></form>');
    const [detected] = detectLoginForms(document);
    expect(detected.username.id).toBe('u');
    expect(detected.password).toBeNull();
  });

  it('handles a two-step login where only the password is shown', () => {
    mount('<form><input type="password" autocomplete="current-password" id="p" /></form>');
    const [detected] = detectLoginForms(document);
    expect(detected.password.id).toBe('p');
    expect(detected.username).toBeNull();
  });

  it('finds fields not wrapped in a form element', () => {
    mount(`
      <div>
        <input type="text" name="login" />
        <input type="password" name="pass" />
      </div>
    `);
    const [detected] = detectLoginForms(document);
    expect(detected.username.name).toBe('login');
    expect(detected.password.name).toBe('pass');
  });

  it('separates two independent forms on one page', () => {
    mount(`
      <form id="signin"><input name="user" /><input type="password" /></form>
      <form id="register">
        <input name="email" type="email" />
        <input type="password" autocomplete="new-password" />
      </form>
    `);
    const detected = detectLoginForms(document);
    expect(detected).toHaveLength(2);
    expect(detected.map((d) => d.kind).sort()).toEqual(['login', 'signup']);
  });

  it('reaches inputs inside an open shadow root', () => {
    // Design-system components wrap inputs this way; stopping at the boundary
    // means autofill silently does nothing on them.
    mount('<div id="host"></div>');
    const shadow = document.getElementById('host').attachShadow({ mode: 'open' });
    shadow.innerHTML = '<input name="username" /><input type="password" name="pw" />';

    expect(collectInputs(document)).toHaveLength(2);
    const [detected] = detectLoginForms(document);
    expect(detected.password.name).toBe('pw');
  });

  it('returns nothing on a page with no credential fields', () => {
    mount('<form><input type="search" name="q" /><button>Go</button></form>');
    expect(detectLoginForms(document)).toEqual([]);
  });
});

describe('isFillable', () => {
  it('rejects hidden, disabled and read-only inputs', () => {
    mount(`
      <input id="a" type="password" disabled />
      <input id="b" type="password" readonly />
      <input id="c" type="hidden" />
      <input id="d" type="password" aria-hidden="true" />
      <input id="e" type="password" style="display:none" />
      <input id="f" type="password" />
    `);
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      expect(isFillable(document.getElementById(id)), id).toBe(false);
    }
    expect(isFillable(document.getElementById('f'))).toBe(true);
  });

  it('excludes hidden decoy fields from detection', () => {
    // Sites keep decoys in the DOM; filling one puts a credential somewhere
    // the user cannot see.
    mount(`
      <form>
        <input type="password" name="decoy" style="display:none" />
        <input type="text" name="user" />
        <input type="password" name="real" />
      </form>
    `);
    expect(detectLoginForms(document)[0].password.name).toBe('real');
  });
});

describe('scoreUsernameField', () => {
  const score = (html) => {
    mount(html);
    return scoreUsernameField(document.querySelector('input'));
  };

  it('trusts an explicit autocomplete above everything else', () => {
    expect(score('<input autocomplete="username" name="xyz123" />')).toBe(100);
    expect(score('<input autocomplete="email" />')).toBe(100);
  });

  it('scores an email input highly', () => {
    expect(score('<input type="email" />')).toBeGreaterThan(30);
  });

  it('recognises meaningful names and labels', () => {
    expect(score('<input type="text" name="user_login" />')).toBeGreaterThan(
      score('<input type="text" name="field_1" />'),
    );
    expect(score('<label>Email address<input type="text" /></label>')).toBeGreaterThan(
      score('<input type="text" />'),
    );
  });

  it('rejects fields that only look like usernames', () => {
    expect(score('<input type="text" name="search_query" />')).toBe(0);
    expect(score('<input type="text" name="coupon_code" />')).toBe(0);
    expect(score('<input type="text" placeholder="Enter OTP code" />')).toBe(0);
  });

  it('respects autocomplete="off" as a refusal', () => {
    expect(score('<input type="email" autocomplete="off" />')).toBe(0);
  });

  it('scores non-text input types at zero', () => {
    expect(score('<input type="checkbox" name="username" />')).toBe(0);
  });
});

describe('classifyPasswordField', () => {
  const classify = (html) => {
    mount(html);
    return classifyPasswordField(document.querySelector('input'));
  };

  it('reads autocomplete when present', () => {
    expect(classify('<input type="password" autocomplete="new-password" />')).toBe('new');
    expect(classify('<input type="password" autocomplete="current-password" />')).toBe('current');
  });

  it('falls back to naming conventions', () => {
    expect(classify('<input type="password" name="confirm_password" />')).toBe('new');
    expect(classify('<input type="password" name="password_repeat" />')).toBe('new');
    expect(classify('<input type="password" id="newPassword" />')).toBe('new');
    expect(classify('<input type="password" name="password" />')).toBe('current');
  });

  it('reads visible label text', () => {
    expect(classify('<label>Retype password<input type="password" /></label>')).toBe('new');
  });
});

describe('isPasswordField', () => {
  it('recognises type=password', () => {
    mount('<input type="password" />');
    expect(isPasswordField(document.querySelector('input'))).toBe(true);
  });

  it('recognises a text input a site reveals via its own toggle', () => {
    mount('<input type="text" autocomplete="current-password" />');
    expect(isPasswordField(document.querySelector('input'))).toBe(true);
  });

  it('rejects ordinary text inputs', () => {
    mount('<input type="text" name="username" />');
    expect(isPasswordField(document.querySelector('input'))).toBe(false);
  });
});
