/**
 * Decoding QR images inside the extension's own page.
 *
 * The decoder lives here rather than in the content script on purpose. It is
 * roughly 250KB of pure computation, and the content script runs on every
 * page the user visits — injecting it everywhere to serve an action taken
 * once, on one page, would be an unreasonable cost. The content script
 * rasterises the QR image instead and hands the pixels over.
 *
 * jsQR is Apache-2.0 with no dependencies. It reads an array of pixels and
 * returns a string: no network, no storage, no DOM. That is a small enough
 * surface to accept in a password manager, and it is bundled rather than
 * loaded remotely, which the extension's CSP forbids anyway.
 *
 * It is also imported lazily. At ~250KB it is by far the largest thing in
 * the extension, and the popup would otherwise parse all of it on every
 * open to serve a feature used once per account. The dynamic import puts it
 * in its own chunk, fetched from local disk only when a scan actually needs
 * it.
 */

/** Resolved once, then reused for the life of the page. */
let decoderPromise = null;

function loadDecoder() {
  if (decoderPromise === null) {
    decoderPromise = import('jsqr').then((module) => module.default);
  }
  return decoderPromise;
}

/** A full otpauth URI anywhere in decoded text. */
const OTPAUTH_PATTERN = /otpauth:\/\/totp\/[^\s"'<>]+/i;

/**
 * Turn a data URL into raw pixels.
 *
 * @param {string} dataUrl
 * @returns {Promise<ImageData|null>}
 */
function toImageData(dataUrl) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      try {
        resolve(context.getImageData(0, 0, canvas.width, canvas.height));
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = dataUrl;
  });
}

/**
 * Read a QR code from one rasterised image.
 *
 * Tried at full size first, then inverted. Some sites render QR codes light
 * on dark — in a dark theme especially — and a decoder that only handles the
 * conventional polarity fails on them with no useful explanation.
 *
 * @param {string} dataUrl
 * @returns {Promise<string|null>} the decoded text
 */
export async function decodeQrDataUrl(dataUrl) {
  const pixels = await toImageData(dataUrl);
  if (pixels === null) {
    return null;
  }

  const jsQR = await loadDecoder();

  for (const inversion of ['dontInvert', 'onlyInvert']) {
    const result = jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: inversion });
    if (result?.data) {
      return result.data;
    }
  }
  return null;
}

/**
 * Find a TOTP setup URI among rasterised QR images.
 *
 * @param {string[]} dataUrls
 * @returns {Promise<{uri: string, source: 'image'}|null>}
 */
export async function findTotpInImages(dataUrls) {
  for (const dataUrl of dataUrls) {
    const decoded = await decodeQrDataUrl(dataUrl);
    if (decoded === null) {
      continue;
    }
    const match = OTPAUTH_PATTERN.exec(decoded);
    if (match !== null) {
      return { uri: match[0], source: 'image' };
    }
  }
  return null;
}
