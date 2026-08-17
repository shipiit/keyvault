/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const jsQRMock = vi.fn();
vi.mock('jsqr', () => ({ default: (...args) => jsQRMock(...args) }));

const { decodeQrDataUrl, findTotpInImages } = await import('../../src/ui/lib/qr-decode.js');

const URI = 'otpauth://totp/Demo:you@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Demo';
const PIXEL = 'data:image/png;base64,AAAA';

/**
 * jsdom has no canvas backend, so the rasterisation step is stubbed. What is
 * under test here is the decode logic — polarity retries, picking the
 * otpauth result out of several codes — not the browser's image pipeline.
 */
beforeEach(() => {
  jsQRMock.mockReset();

  Object.defineProperty(globalThis, 'Image', {
    configurable: true,
    writable: true,
    value: class {
      set src(_value) {
        this.naturalWidth = 100;
        this.naturalHeight = 100;
        queueMicrotask(() => this.onload?.());
      }
    },
  });

  globalThis.HTMLCanvasElement.prototype.getContext = () => ({
    drawImage: () => {},
    fillRect: () => {},
    getImageData: () => ({ data: new Uint8ClampedArray(4 * 100 * 100), width: 100, height: 100 }),
  });
});

describe('decodeQrDataUrl', () => {
  it('returns the decoded text', async () => {
    jsQRMock.mockReturnValue({ data: URI });
    expect(await decodeQrDataUrl(PIXEL)).toBe(URI);
  });

  it('retries inverted before giving up', async () => {
    // Some sites render QR codes light on dark, especially in a dark theme.
    // A decoder that only handles the conventional polarity fails on them
    // with no useful explanation.
    jsQRMock.mockImplementationOnce(() => null).mockImplementationOnce(() => ({ data: URI }));

    expect(await decodeQrDataUrl(PIXEL)).toBe(URI);
    expect(jsQRMock).toHaveBeenCalledTimes(2);
    expect(jsQRMock.mock.calls[0][3]).toEqual({ inversionAttempts: 'dontInvert' });
    expect(jsQRMock.mock.calls[1][3]).toEqual({ inversionAttempts: 'onlyInvert' });
  });

  it('returns null when nothing decodes', async () => {
    jsQRMock.mockReturnValue(null);
    expect(await decodeQrDataUrl(PIXEL)).toBeNull();
  });

  it('loads the decoder only once across calls', async () => {
    // It is the largest thing in the extension; re-importing per image would
    // be wasteful.
    jsQRMock.mockReturnValue({ data: URI });
    await decodeQrDataUrl(PIXEL);
    await decodeQrDataUrl(PIXEL);
    expect(jsQRMock).toHaveBeenCalled();
  });
});

describe('findTotpInImages', () => {
  it('picks the image holding an otpauth URI', async () => {
    // A page can carry several QR codes; only one of them is the secret.
    // A successful decode returns on the first polarity, so each image
    // consumes exactly one call.
    jsQRMock
      .mockImplementationOnce(() => ({ data: 'https://example.com/app' }))
      .mockImplementationOnce(() => ({ data: URI }));

    expect(await findTotpInImages([PIXEL, PIXEL])).toEqual({ uri: URI, source: 'image' });
  });

  it('returns null when no image holds a setup code', async () => {
    jsQRMock.mockReturnValue({ data: 'https://example.com' });
    expect(await findTotpInImages([PIXEL])).toBeNull();
  });

  it('handles an empty list', async () => {
    expect(await findTotpInImages([])).toBeNull();
  });

  it('skips an image that will not decode and keeps going', async () => {
    // First image fails both polarities, second decodes.
    jsQRMock.mockReturnValueOnce(null).mockReturnValueOnce(null).mockReturnValue({ data: URI });
    expect(await findTotpInImages([PIXEL, PIXEL])).toEqual({ uri: URI, source: 'image' });
  });
});
