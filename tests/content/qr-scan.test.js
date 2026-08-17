/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  findOtpauthInText,
  findBareSecretInText,
  qrCandidates,
  canDecodeImages,
  scanPageForTotp,
} from '../../src/content/qr-scan.js';

const REAL_URI =
  'otpauth://totp/Example%3Ayou%40example.com?secret=K5XQ7ZTM2WFB4HRJ6NPD3SVA5YCE7GLU&algorithm=SHA1&digits=6&period=30&issuer=Example';

/**
 * jsdom does not implement innerText. The scanner uses it deliberately —
 * it reflects what the user can see — so the tests define it in terms of
 * textContent, which is the closest jsdom offers.
 */
beforeEach(() => {
  Object.defineProperty(globalThis.HTMLElement.prototype, 'innerText', {
    configurable: true,
    get() {
      return this.textContent;
    },
  });
  document.body.innerHTML = '';
});

afterEach(() => {
  delete globalThis.BarcodeDetector;
});

describe('findOtpauthInText', () => {
  it('finds the URI a setup page prints under the QR image', () => {
    // The common case, and the reason text is tried before pixels: 2FA pages
    // print the URI so it can be typed into a device with no camera.
    document.body.innerHTML = `<div><img alt="QR"><p>${REAL_URI}</p></div>`;
    expect(findOtpauthInText(document).uri).toBe(REAL_URI);
    expect(findOtpauthInText(document).source).toBe('text');
  });

  it('finds a URI embedded in surrounding prose', () => {
    document.body.innerHTML = `<p>Scan this, or use otpauth://totp/A?secret=JBSWY3DPEHPK3PXP to set up</p>`;
    expect(findOtpauthInText(document).uri).toBe('otpauth://totp/A?secret=JBSWY3DPEHPK3PXP');
  });

  it('finds a URI held in a copy-button attribute', () => {
    document.body.innerHTML = `<button data-clipboard-text="${REAL_URI}">Copy</button>`;
    expect(findOtpauthInText(document).uri).toBe(REAL_URI);
  });

  it('finds a URI in a link href', () => {
    document.body.innerHTML = `<a href="${REAL_URI}">Add to authenticator</a>`;
    expect(findOtpauthInText(document).uri).toBe(REAL_URI);
  });

  it('stops at the first whitespace or quote, not mid-URI', () => {
    document.body.innerHTML = `<p>otpauth://totp/A?secret=JBSWY3DPEHPK3PXP and then some words</p>`;
    expect(findOtpauthInText(document).uri).toBe('otpauth://totp/A?secret=JBSWY3DPEHPK3PXP');
  });

  it('returns null on a page with no setup code', () => {
    document.body.innerHTML = '<p>Just an ordinary page</p>';
    expect(findOtpauthInText(document)).toBeNull();
  });
});

describe('findOtpauthInText — defensive paths', () => {
  it('survives a document with no body', () => {
    const empty = new DOMParser().parseFromString('<html></html>', 'text/html');
    empty.documentElement.querySelector('body')?.remove();
    expect(() => findOtpauthInText(empty)).not.toThrow();
  });

  it('ignores elements whose attributes hold no URI', () => {
    document.body.innerHTML = '<a href="https://example.com">Link</a><input value="hello">';
    expect(findOtpauthInText(document)).toBeNull();
  });

  it('ignores a non-totp otpauth type', () => {
    document.body.innerHTML = '<p>otpauth://hotp/A?secret=JBSWY3DPEHPK3PXP&counter=1</p>';
    expect(findOtpauthInText(document)).toBeNull();
  });
});

describe('findBareSecretInText — must never guess', () => {
  const KEY = 'K5XQ7ZTM2WFB4HRJ6NPD3SVA5YCE7GLU';
  const find = (text) => {
    document.body.textContent = text;
    return findBareSecretInText(document)?.secret ?? null;
  };

  it('refuses a real two-step page that only shows a QR and backup codes', () => {
    // The bug this guards. An earlier pattern matched the page heading and
    // stored "STEPVERIFICATIONSCANTHE" as the secret. The entry looked
    // correct and produced six digits, and the site rejected every one.
    expect(
      find(
        'TWO-STEP VERIFICATION\n' +
          'Scan the QR code with your authenticator app, then enter the 6-digit code below.\n' +
          'First-time setup\nBackup codes\n' +
          'r6746fah z5pkxwvl\nzbzcnx7n jr333ds6\nk2qtuuuq hu6les52',
      ),
    ).toBeNull();
  });

  it('refuses ordinary prose, which is entirely valid base32', () => {
    expect(find('Lost your key? Use a backup code shown above to continue')).toBeNull();
    expect(find('PLEASE ENTER THE CODE SHOWN ABOVE TO CONTINUE NOW')).toBeNull();
  });

  it('refuses a key with no caption saying what it is', () => {
    expect(find(KEY)).toBeNull();
  });

  it('refuses a long word sitting after a key caption', () => {
    expect(find('Secret internationalization')).toBeNull();
  });

  it('refuses anything below the 80-bit floor', () => {
    expect(find('Setup key: ABCD')).toBeNull();
    expect(find('Setup key: K5XQ7ZTM2WFB4H')).toBeNull();
  });

  it('finds a key the page has captioned', () => {
    expect(find(`Setup key: ${KEY}`)).toBe(KEY);
    expect(find(`Secret = ${KEY}`)).toBe(KEY);
    expect(find(`Your secret is ${KEY}`)).toBe(KEY);
  });

  it('finds a key on the line after its caption', () => {
    expect(find(`Manual entry code\n${KEY}`)).toBe(KEY);
  });

  it('finds a key printed in evenly sized groups', () => {
    expect(find('Setup key:\nK5XQ 7ZTM 2WFB 4HRJ 6NPD 3SVA 5YCE 7GLU')).toBe(KEY);
  });

  it('does not reach paragraphs away from the caption', () => {
    // A key is printed beside its caption. A wider window is only a wider
    // chance of matching something unrelated.
    expect(find(`Setup key:\n${'filler text here. '.repeat(20)}\n${KEY}`)).toBeNull();
  });
});

describe('qrCandidates', () => {
  it('keeps images that are large and roughly square', () => {
    document.body.innerHTML = '<img id="qr" width="200" height="200">';
    expect(qrCandidates(document)).toHaveLength(1);
  });

  it('skips small images and wide banners', () => {
    document.body.innerHTML = `
      <img width="16" height="16">
      <img width="900" height="90">
    `;
    expect(qrCandidates(document)).toHaveLength(0);
  });
});

describe('qrCandidates — sizing', () => {
  it('uses layout size when width and height attributes are absent', () => {
    document.body.innerHTML = '<canvas id="c"></canvas>';
    // jsdom reports zero for both, so the element is correctly skipped
    // rather than decoded pointlessly.
    expect(qrCandidates(document)).toHaveLength(0);
  });

  it('skips a tall narrow image', () => {
    document.body.innerHTML = '<img width="100" height="400">';
    expect(qrCandidates(document)).toHaveLength(0);
  });
});

describe('canDecodeImages', () => {
  it('reports the capability rather than assuming it', () => {
    expect(canDecodeImages()).toBe(false);
    globalThis.BarcodeDetector = function BarcodeDetector() {};
    expect(canDecodeImages()).toBe(true);
  });
});

describe('scanPageForTotp', () => {
  it('prefers the printed URI over decoding an image', async () => {
    let decoded = false;
    globalThis.BarcodeDetector = class {
      async detect() {
        decoded = true;
        return [];
      }
    };
    document.body.innerHTML = `<img width="200" height="200"><p>${REAL_URI}</p>`;

    const result = await scanPageForTotp(document);

    expect(result).toEqual({ found: true, uri: REAL_URI, source: 'text' });
    expect(decoded, 'should not decode when the URI is written on the page').toBe(false);
  });

  it('falls back to decoding the QR image', async () => {
    globalThis.BarcodeDetector = class {
      async detect() {
        return [{ rawValue: REAL_URI }];
      }
    };
    document.body.innerHTML = '<img width="200" height="200">';

    expect(await scanPageForTotp(document)).toEqual({
      found: true,
      uri: REAL_URI,
      source: 'image',
    });
  });

  it('survives an image it cannot read', async () => {
    // A cross-origin or tainted image throws. One unreadable image is not a
    // failed scan.
    globalThis.BarcodeDetector = class {
      async detect() {
        throw new Error('tainted canvas');
      }
    };
    document.body.innerHTML = '<img width="200" height="200"><p>Key: JBSW Y3DP EHPK 3PXP MPSM</p>';

    const result = await scanPageForTotp(document);
    expect(result.found).toBe(true);
    expect(result.source).toBe('secret');
  });

  it('explains what to do when nothing is found', async () => {
    document.body.innerHTML = '<p>Nothing here</p>';
    const result = await scanPageForTotp(document);
    expect(result.found).toBe(false);
    expect(result.reason).toMatch(/QR/i);
  });

  it('returns nothing from the image path when the API is missing', async () => {
    document.body.innerHTML = '<img width="200" height="200">';
    expect(canDecodeImages()).toBe(false);
    const result = await scanPageForTotp(document);
    expect(result.found).toBe(false);
  });

  it('ignores a decoded barcode that is not an otpauth URI', async () => {
    // A page can hold QR codes for other things entirely.
    globalThis.BarcodeDetector = class {
      async detect() {
        return [{ rawValue: 'https://example.com/not-a-secret' }];
      }
    };
    document.body.innerHTML = '<img width="200" height="200">';
    expect((await scanPageForTotp(document)).found).toBe(false);
  });

  it('hands the QR images out for the extension page to decode', async () => {
    // The decoder is ~250KB and this script runs on every page the user
    // visits, so the pixels go to the extension's own page instead.
    globalThis.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AAAA';
    globalThis.HTMLCanvasElement.prototype.getContext = () => ({
      drawImage: () => {},
      fillRect: () => {},
    });
    const image = document.createElement('img');
    image.width = 200;
    image.height = 200;
    Object.defineProperty(image, 'complete', { value: true });
    Object.defineProperty(image, 'naturalWidth', { value: 200 });
    document.body.append(image);

    const result = await scanPageForTotp(document);

    expect(result.found).toBe(false);
    expect(result.images).toEqual(['data:image/png;base64,AAAA']);
    expect(result.reason).toMatch(/could not read it here/i);
  });

  it('reports plainly when there is no QR image at all', async () => {
    document.body.innerHTML = '<p>Nothing to see</p>';
    const result = await scanPageForTotp(document);
    expect(result.found).toBe(false);
    expect(result.images).toEqual([]);
    expect(result.reason).toMatch(/no two-factor setup code or QR image/i);
  });
});
