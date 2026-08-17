/**
 * Finding a TOTP setup secret on the page the user is looking at.
 *
 * Two strategies, cheapest and most reliable first:
 *
 *  1. **Read the text.** Most 2FA setup pages print the `otpauth://` URI, or
 *     the bare base32 secret, next to the QR image — precisely so it can be
 *     typed into a device that has no camera. Parsing text is exact: there is
 *     no decode step to get wrong.
 *
 *  2. **Decode the image.** If no URI is written down, try the browser's
 *     native `BarcodeDetector` on any QR-shaped image on the page.
 *
 *  3. **Hand the pixels out.** `BarcodeDetector` is absent on several
 *     desktop platforms. Rather than inject a 250KB decoder into every page
 *     the user visits, the QR images are rasterised here and returned as
 *     data URLs for the extension's own page to decode. The decoder is
 *     needed once, in one place, not on every page load.
 *
 * The result always says which strategy found the secret, so the UI can tell
 * the user what actually happened when none of them work.
 */

/** A full otpauth URI anywhere in a block of text. */
const OTPAUTH_PATTERN = /otpauth:\/\/totp\/[^\s"'<>]+/i;

/**
 * Search the page's visible text for a setup secret.
 *
 * @param {Document} doc
 * @returns {{uri: string, source: 'text'}|null}
 */
export function findOtpauthInText(doc) {
  // innerText rather than textContent: it reflects what the user can
  // actually see, so a URI hidden in a <script> or a display:none block is
  // not picked up.
  const visible = doc.body?.innerText ?? '';

  const direct = OTPAUTH_PATTERN.exec(visible);
  if (direct !== null) {
    return { uri: direct[0], source: 'text' };
  }

  // Some pages put the URI in an attribute rather than in text — a copy
  // button's data value, or a link.
  for (const element of doc.querySelectorAll('[href], [value], [data-clipboard-text]')) {
    for (const attribute of ['href', 'value', 'data-clipboard-text']) {
      const candidate = element.getAttribute?.(attribute);
      if (typeof candidate === 'string') {
        const match = OTPAUTH_PATTERN.exec(candidate);
        if (match !== null) {
          return { uri: match[0], source: 'text' };
        }
      }
    }
  }
  return null;
}

/**
 * Search for a bare setup key that the page has explicitly labelled.
 *
 * **This must never guess.** Every letter A–Z is a valid base32 character,
 * so ordinary prose matches a naive pattern: on a real two-step setup page
 * this once matched the heading "STEP VERIFICATION SCAN THE" and stored it
 * as the secret. The failure is silent — the entry looks fine and produces
 * six digits — and only surfaces when the site rejects the code.
 *
 * So a match requires an adjacent label saying what it is, and the key must
 * be a single unbroken token or evenly spaced groups. Prose satisfies
 * neither.
 *
 * @param {Document} doc
 * @returns {{secret: string, source: 'secret'}|null}
 */
export function findBareSecretInText(doc) {
  const visible = doc.body?.innerText ?? '';

  // Find where the page says it is about to give you a key. Without this
  // anchor there is no way to tell a secret from a sentence.
  const label = /(?:secret|setup\s*key|manual\s*(?:entry|code|setup)|account\s*key|\bkey\b)/i.exec(
    visible,
  );
  if (label === null) {
    return null;
  }

  // Look only just past the label. A key is printed next to its caption,
  // never paragraphs away, and a wider window is a wider chance of matching
  // unrelated text.
  const window = visible.slice(label.index + label[0].length, label.index + label[0].length + 160);

  // Consider each line separately: the key is on its own line, or directly
  // after the caption on the same one.
  for (const line of window.split('\n')) {
    const secret = keyFromLine(line);
    if (secret !== null) {
      return { secret, source: 'secret' };
    }
  }
  return null;
}

/**
 * A setup key on one line, or null.
 *
 * A real key is a single unbroken token, or evenly sized groups — never a
 * run of words of differing lengths. That distinction is what separates
 * `MPSM R2AS VWLI USL7` from `code shown above to continue`.
 *
 * @param {string} line
 * @returns {string|null}
 */
function keyFromLine(line) {
  const tokens = line
    .trim()
    .replace(/^[:=\s]+/, '')
    .split(/[\s-]+/)
    .filter(Boolean);

  // Try each starting position, so connective words between the caption and
  // the key — "Your secret is ABCD…" — do not hide it.
  for (let start = 0; start < tokens.length; start += 1) {
    const run = [];
    for (let index = start; index < tokens.length; index += 1) {
      if (!/^[A-Za-z2-7]+$/.test(tokens[index])) {
        break;
      }
      run.push(tokens[index]);
    }
    const secret = keyFromRun(run);
    if (secret !== null) {
      return secret;
    }
  }
  return null;
}

/**
 * A key from a run of tokens, or null.
 *
 * @param {string[]} run
 * @returns {string|null}
 */
function keyFromRun(run) {
  if (run.length === 0) {
    return null;
  }
  // A real key is one unbroken token, or evenly sized groups. A run of words
  // of differing lengths is prose.
  if (run.length > 1 && new Set(run.map((token) => token.length)).size !== 1) {
    return null;
  }

  const compact = run.join('').toUpperCase();

  // RFC 4226 puts the floor at 80 bits, which is 16 base32 characters.
  if (compact.length < 16 || !/^[A-Z2-7]+$/.test(compact)) {
    return null;
  }

  // At least one digit. Every letter A–Z is valid base32, so a long enough
  // English word passes every other check — and storing a word as a secret
  // produces six digits the site will always reject, silently.
  //
  // The cost is a false negative on a key that happens to be all letters:
  // for a 16-character key that is about one in thirty, and those users
  // paste the key by hand instead. A missed detection is recoverable in
  // seconds; a wrong secret is not noticed for weeks.
  return /[2-7]/.test(compact) ? compact : null;
}

/** @returns {boolean} whether this browser can decode a QR image natively */
export function canDecodeImages() {
  return typeof globalThis.BarcodeDetector === 'function';
}

/**
 * Images on the page big enough and square enough to be a QR code.
 *
 * Filtering first keeps the decode cheap: a page can hold dozens of images
 * and decoding each one is far more expensive than measuring it.
 *
 * @param {Document} doc
 * @returns {Element[]}
 */
export function qrCandidates(doc) {
  const elements = [...doc.querySelectorAll('img, canvas, svg')];
  return elements.filter((element) => {
    const width = element.width ?? element.clientWidth ?? 0;
    const height = element.height ?? element.clientHeight ?? 0;
    if (width < 80 || height < 80) {
      return false;
    }
    const ratio = width / height;
    return ratio > 0.7 && ratio < 1.4;
  });
}

/**
 * Decode any QR code visible on the page.
 *
 * @param {Document} doc
 * @returns {Promise<{uri: string, source: 'image'}|null>}
 */
export async function decodeQrOnPage(doc) {
  if (!canDecodeImages()) {
    return null;
  }
  const detector = new globalThis.BarcodeDetector({ formats: ['qr_code'] });

  for (const element of qrCandidates(doc)) {
    try {
      const results = await detector.detect(element);
      for (const result of results) {
        const match = OTPAUTH_PATTERN.exec(result.rawValue ?? '');
        if (match !== null) {
          return { uri: match[0], source: 'image' };
        }
      }
    } catch {
      // A tainted canvas, a cross-origin image, or an element that is not
      // yet decoded. Move on — one unreadable image is not a failure.
      continue;
    }
  }
  return null;
}

/**
 * Rasterise an element to a PNG data URL.
 *
 * Returns null rather than throwing for the two normal failures: a
 * cross-origin image taints the canvas so its pixels cannot be read back,
 * and an element that has not finished decoding has nothing to draw.
 *
 * @param {Element} element
 * @returns {Promise<string|null>}
 */
async function rasterise(element) {
  try {
    if (element.tagName === 'CANVAS') {
      return element.toDataURL('image/png');
    }

    const source = await asImage(element);
    if (source === null) {
      return null;
    }

    const canvas = document.createElement('canvas');
    // Cap the size: a QR code needs only a few hundred pixels to decode, and
    // the result crosses a message boundary.
    const scale = Math.min(1, 512 / Math.max(source.width, source.height, 1));
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));

    const context = canvas.getContext('2d');
    // QR codes are black on white; a transparent PNG drawn onto nothing
    // decodes as a solid block.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);

    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

/**
 * Get something drawable from an element.
 *
 * SVG is serialised and reloaded as an image: it cannot be drawn to a canvas
 * directly, and inline SVG is a common way to render a QR code.
 *
 * @param {Element} element
 * @returns {Promise<HTMLImageElement|null>}
 */
function asImage(element) {
  if (element.tagName === 'IMG') {
    return Promise.resolve(element.complete && element.naturalWidth > 0 ? element : null);
  }
  if (element.tagName !== 'svg') {
    return Promise.resolve(null);
  }

  const markup = new XMLSerializer().serializeToString(element);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

/**
 * Rasterise every plausible QR code on the page.
 *
 * @param {Document} doc
 * @returns {Promise<string[]>} PNG data URLs
 */
export async function captureQrImages(doc) {
  const captured = [];
  // Bounded: a handful is plenty, and each one costs a message payload.
  for (const element of qrCandidates(doc).slice(0, 4)) {
    const dataUrl = await rasterise(element);
    if (dataUrl !== null) {
      captured.push(dataUrl);
    }
  }
  return captured;
}

/**
 * Look for a TOTP secret on this page, cheapest strategy first.
 *
 * @param {Document} [doc]
 * @returns {Promise<{found: boolean, uri?: string, secret?: string,
 *                    source?: string, reason?: string}>}
 */
export async function scanPageForTotp(doc = document) {
  const inText = findOtpauthInText(doc);
  if (inText !== null) {
    return { found: true, ...inText };
  }

  const inImage = await decodeQrOnPage(doc);
  if (inImage !== null) {
    return { found: true, ...inImage };
  }

  // Deliberately last, and deliberately conservative — see
  // findBareSecretInText. A wrong secret stored silently is worse than no
  // secret stored at all: the entry looks correct and produces six digits
  // that the site will always reject.
  const bare = findBareSecretInText(doc);
  if (bare !== null) {
    return { found: true, ...bare };
  }

  // Nothing readable here. Hand back the QR images so the extension's own
  // page can decode them, rather than shipping a decoder into every page.
  const images = await captureQrImages(doc);
  return {
    found: false,
    images,
    reason:
      images.length === 0
        ? 'No two-factor setup code or QR image found on this page.'
        : 'Found a QR image but could not read it here.',
  };
}
