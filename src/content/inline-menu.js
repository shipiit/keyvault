/**
 * The KeyVault badge inside a login field, and the menu it opens.
 *
 * This is the interaction people actually use: a mark in the field, a click,
 * a list of matching logins, one of them filled. Everything else in the
 * extension is reachable from the popup, but only this is reachable without
 * leaving the page.
 *
 * Both the badge and the menu live in a **closed shadow root** on an element
 * appended to `documentElement`. The host page can neither restyle them into
 * something misleading nor read what they display. Nothing is positioned
 * inside the page's own DOM, so no layout is disturbed and no framework
 * re-render can tear it out.
 *
 * The menu shows metadata only. A password is fetched at the moment one is
 * chosen, so a page that never gets a click never has anything to read.
 */

const HOST_ID = 'keyvault-inline-menu';

const STYLES = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: inherit; }

  .badge {
    position: fixed; z-index: 2147483646;
    width: 24px; height: 24px; padding: 0;
    display: grid; place-items: center; cursor: pointer;
    border: 0; border-radius: 6px; background: #4f46e5;
    box-shadow: 0 1px 3px rgba(15, 18, 25, 0.3);
    transition: filter 120ms;
  }
  .badge:hover { filter: brightness(1.12); }
  .badge:focus-visible { outline: 2px solid #4f46e5; outline-offset: 2px; }
  .badge svg { width: 14px; height: 14px; fill: #ffffff; }

  .menu {
    position: fixed; z-index: 2147483647; min-width: 280px; max-width: 360px;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: #ffffff; color: #16181d;
    border: 1px solid #d9dce3; border-radius: 12px;
    box-shadow: 0 12px 32px rgba(15, 18, 25, 0.18);
    padding: 6px; overflow: hidden;
  }
  .head {
    display: flex; align-items: center; gap: 6px;
    padding: 6px 8px 8px; font-size: 11px; font-weight: 600;
    letter-spacing: 0.04em; text-transform: uppercase; color: #7a8194;
  }
  .item {
    display: flex; align-items: center; gap: 10px; width: 100%;
    padding: 8px; border: 0; border-radius: 8px; cursor: pointer;
    background: none; text-align: left; color: inherit;
  }
  .item:hover, .item:focus-visible { background: #f1f2f6; outline: none; }
  .item .avatar {
    width: 30px; height: 30px; flex: none; border-radius: 7px;
    display: grid; place-items: center; color: #fff; font-size: 13px; font-weight: 600;
  }
  .item .lines { min-width: 0; flex: 1; }
  .item .title { display: block; font-size: 13px; font-weight: 500;
                 overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .item .sub { display: block; font-size: 12px; color: #5a6172;
               overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .empty { padding: 4px 8px 10px; font-size: 12px; color: #5a6172; }
  .rule { height: 1px; background: #e6e8ee; margin: 4px 0; }
  .action { font-size: 12px; color: #4f46e5; font-weight: 500; }

  @media (prefers-color-scheme: dark) {
    .menu { background: #1c1f26; color: #f2f3f6; border-color: #333844;
            box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55); }
    .head, .item .sub, .empty { color: #a2a8b8; }
    .item:hover, .item:focus-visible { background: #262a33; }
    .rule { background: #333844; }
    .action { color: #8b83ff; }
  }
`;

/** The live badge and menu, if any. */
let current = null;

/** @returns {SVGElement} the KeyVault shield */
function shieldMark() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M12 3.2 4.6 5.9v5.6c0 4.3 2.9 7.8 7.4 9.3 4.5-1.5 7.4-5 7.4-9.3V5.9z');
  svg.append(path);
  return svg;
}

/** Deterministic colour from a title, matching the vault list. */
function avatarColour(title) {
  const hue = [...(title || '?')].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 360, 7);
  return `oklch(0.62 0.15 ${hue})`;
}

/** Remove the badge and menu entirely. */
export function removeInlineMenu() {
  current?.host.remove();
  current = null;
  document.getElementById(HOST_ID)?.remove();
}

/** Test and diagnostic hook; unreachable from page script. */
export function currentInlineMenu() {
  return current;
}

/**
 * Attach the badge to a field.
 *
 * @param {object} options
 * @param {HTMLInputElement} options.field the input to sit inside
 * @param {'login'|'password'} options.kind which menu to offer
 * @param {() => Promise<object[]>} options.loadEntries matching entries, metadata only
 * @param {(id: string) => void} options.onChoose
 * @param {() => void} [options.onGenerate] offered on password fields only
 * @param {() => void} [options.onOpenVault]
 */
export function attachInlineMenu({ field, kind, loadEntries, onChoose, onGenerate, onOpenVault }) {
  removeInlineMenu();

  const host = document.createElement('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = STYLES;

  const badge = document.createElement('button');
  badge.type = 'button';
  badge.className = 'badge';
  badge.setAttribute('aria-label', 'KeyVault: fill a saved login');
  badge.append(shieldMark());

  shadow.append(style, badge);
  document.documentElement.append(host);

  current = { host, shadow, badge, field, menu: null };

  const place = () => {
    const box = field.getBoundingClientRect();
    // Hidden rather than removed when the field scrolls out of view: the
    // page may scroll it back, and re-attaching would lose the menu.
    const visible = box.width > 0 && box.bottom > 0 && box.top < window.innerHeight;
    badge.style.display = visible ? 'grid' : 'none';
    badge.style.top = `${box.top + (box.height - 24) / 2}px`;
    // Inset from the right edge, clear of the field's own border.
    badge.style.left = `${box.right - 30}px`;
    if (current?.menu !== null && current?.menu !== undefined) {
      current.menu.style.top = `${box.bottom + 6}px`;
      current.menu.style.left = `${box.left}px`;
      current.menu.style.width = `${Math.max(box.width, 280)}px`;
    }
  };

  place();
  const reposition = () => place();
  window.addEventListener('scroll', reposition, true);
  window.addEventListener('resize', reposition);
  current.detach = () => {
    window.removeEventListener('scroll', reposition, true);
    window.removeEventListener('resize', reposition);
  };

  badge.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (current?.menu !== null && current?.menu !== undefined) {
      closeMenu();
      return;
    }
    await openMenu();
  });

  function closeMenu() {
    current?.menu?.remove();
    if (current !== null) {
      current.menu = null;
    }
    document.removeEventListener('mousedown', onOutside, true);
  }

  function onOutside(event) {
    // The menu lives in a closed root on documentElement, so any page click
    // is outside it by definition.
    if (event.target !== host) {
      closeMenu();
    }
  }

  async function openMenu() {
    // A locked vault makes this reject. The menu still opens: it is where
    // "Open KeyVault" lives, which is how the user unlocks. A badge that
    // does nothing on click reads as broken.
    const entries = await loadEntries().catch(() => []);

    const menu = document.createElement('div');
    menu.className = 'menu';
    menu.setAttribute('role', 'menu');

    const head = document.createElement('div');
    head.className = 'head';
    head.textContent = entries.length > 0 ? 'Saved logins' : 'KeyVault';
    menu.append(head);

    for (const entry of entries) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'item';
      item.setAttribute('role', 'menuitem');

      const avatar = document.createElement('span');
      avatar.className = 'avatar';
      avatar.style.background = avatarColour(entry.title);
      avatar.textContent = (entry.title || '?').slice(0, 1).toUpperCase();
      avatar.setAttribute('aria-hidden', 'true');

      const lines = document.createElement('span');
      lines.className = 'lines';
      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = entry.title;
      const sub = document.createElement('span');
      sub.className = 'sub';
      sub.textContent = entry.username || 'No username';
      lines.append(title, sub);

      item.append(avatar, lines);
      item.addEventListener('click', () => {
        closeMenu();
        onChoose(entry.id);
      });
      menu.append(item);
    }

    if (entries.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'Nothing saved for this site yet.';
      menu.append(empty);
    }

    if (kind === 'password' && onGenerate !== undefined) {
      menu.append(rule());
      menu.append(actionItem('Generate a password', onGenerate, closeMenu));
    }
    if (onOpenVault !== undefined) {
      menu.append(rule());
      menu.append(actionItem('Open KeyVault', onOpenVault, closeMenu));
    }

    shadow.append(menu);
    current.menu = menu;
    place();
    document.addEventListener('mousedown', onOutside, true);
    menu.querySelector('.item')?.focus();
  }

  function rule() {
    const line = document.createElement('div');
    line.className = 'rule';
    return line;
  }

  function actionItem(label, run, close) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'item';
    item.setAttribute('role', 'menuitem');
    const text = document.createElement('span');
    text.className = 'action';
    text.textContent = label;
    item.append(text);
    item.addEventListener('click', () => {
      close();
      run();
    });
    return item;
  }

  return { remove: removeInlineMenu };
}
