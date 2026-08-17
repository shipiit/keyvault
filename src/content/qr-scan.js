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
 * Strategy 2 is not available everywhere — `BarcodeDetector` is absent on
 * several desktop platforms — so its absence is reported rather than
 * pretended away. The result always says which strategy found the secret, so
 * the UI can tell the user what to do when neither works.
 */

/** A full otpauth URI anywhere in a block of text. */
const OTPAUTH_PATTERN = /otpauth:\/\/totp\/[^\s"'<>]+/i;

/**
 * A bare base32 secret shown on its own, as a fallback.
 *
 * Deliberately strict — at least 16 base32 characters, optionally in
 * space-separated groups. A loose pattern matches hex ids, tracking tokens
 * and CSS class names, and silently stores a secret that will never produce
 * a working code.
 */
const BARE_SECRET_PATTERN = /\b(?:[A-Z2-7]{4}[\s-]?){4,}[A-Z2-7]{0,8}\b/;

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
 * Search the page's visible text for a bare base32 secret.
 *
 * Separate from `findOtpauthInText` and tried last: a bare secret carries no
 * issuer, digits or period, so the caller must fill those in, and the match
 * is inherently less certain.
 *
 * @param {Document} doc
 * @returns {{secret: string, source: 'secret'}|null}
 */
export function findBareSecretInText(doc) {
  const visible = doc.body?.innerText ?? '';
  const match = BARE_SECRET_PATTERN.exec(visible.toUpperCase());
  if (match === null) {
    return null;
  }
  const secret = match[0].replace(/[\s-]/g, '');
  return secret.length >= 16 ? { secret, source: 'secret' } : null;
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

  const bare = findBareSecretInText(doc);
  if (bare !== null) {
    return { found: true, ...bare };
  }

  return {
    found: false,
    reason: canDecodeImages()
      ? 'No two-factor setup code found on this page. Open the page showing the QR code and try again.'
      : 'No setup code found in the page text, and this browser cannot read QR images. ' +
        'Copy the setup key shown next to the QR code and paste it instead.',
  };
}
