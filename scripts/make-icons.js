/**
 * Generate the extension's PNG icons.
 *
 * Written by hand rather than pulling in an image library: the icon is one
 * shield on a rounded square, and a build-time dependency that renders it
 * would be larger than the code that draws it. Running this is a one-off —
 * the PNGs are committed — but keeping the source here means the icon can be
 * regenerated or recoloured without hunting for the original file.
 *
 *   node scripts/make-icons.js
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../src/icons');
const SIZES = [16, 32, 48, 128];

/** Brand indigo, matching --color-brand-600 in the UI tokens. */
const BRAND = [79, 70, 229];
const WHITE = [255, 255, 255];

/**
 * The shield outline, as the Icon.Shield path in the UI, flattened to a
 * polygon in a 24×24 space. Curves are sampled rather than solved: at 128px
 * and below the difference is invisible.
 */
function shieldPolygon() {
  const points = [
    [12, 3.2],
    [4.6, 5.9],
    [4.6, 11.5],
  ];

  // Integer step counts, not accumulated floats. Stepping `t` by 0.05 lands
  // fractionally below zero on the last iteration, and a negative base with
  // a fractional exponent is NaN in JavaScript — one NaN vertex corrupts the
  // whole point-in-polygon test.
  const STEPS = 20;
  const curve = (t) => 7.4 * t ** 1.9;

  // Left flank sweeping down to the point.
  for (let i = 0; i <= STEPS; i += 1) {
    const t = i / STEPS;
    points.push([4.6 + curve(t), 11.5 + 9.3 * t]);
  }
  // Right flank back up.
  for (let i = STEPS; i >= 0; i -= 1) {
    const t = i / STEPS;
    points.push([19.4 - curve(t), 11.5 + 9.3 * t]);
  }

  points.push([19.4, 5.9]);
  return points;
}

/** Even-odd point-in-polygon test. */
function insidePolygon(px, py, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Signed distance to a rounded square, used for the background plate. */
function insideRoundedSquare(px, py, size, radius) {
  const dx = Math.max(radius - px, 0, px - (size - radius));
  const dy = Math.max(radius - py, 0, py - (size - radius));
  return Math.hypot(dx, dy) <= radius;
}

/**
 * Render one icon.
 *
 * Supersampled 4×4 per pixel: at 16px an aliased shield reads as a smudge,
 * and the toolbar icon is the smallest thing the user ever sees.
 */
function renderIcon(size) {
  const polygon = shieldPolygon();
  const radius = size * 0.22;
  const samples = 4;
  const pixels = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let plate = 0;
      let glyph = 0;

      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const px = x + (sx + 0.5) / samples;
          const py = y + (sy + 0.5) / samples;

          if (insideRoundedSquare(px, py, size, radius)) {
            plate += 1;
          }
          // The shield occupies the middle ~72% of the plate.
          const gx = ((px / size) * 24 - 12) / 0.72 + 12;
          const gy = ((py / size) * 24 - 12) / 0.72 + 12;
          if (insidePolygon(gx, gy, polygon)) {
            glyph += 1;
          }
        }
      }

      const total = samples * samples;
      const plateAlpha = plate / total;
      const glyphAlpha = (glyph / total) * plateAlpha;

      // Composite white shield over the brand plate, then the plate over
      // transparency.
      const offset = (y * size + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const blended = BRAND[channel] * (1 - glyphAlpha) + WHITE[channel] * glyphAlpha;
        pixels[offset + channel] = Math.round(blended);
      }
      pixels[offset + 3] = Math.round(plateAlpha * 255);
    }
  }

  return pixels;
}

/** Minimal PNG writer: RGBA, 8-bit, no interlacing. */
function encodePng(pixels, size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return c ^ -1;
}

mkdirSync(outDir, { recursive: true });
for (const size of SIZES) {
  const file = join(outDir, `icon-${size}.png`);
  writeFileSync(file, encodePng(renderIcon(size), size));
  console.warn(`wrote ${file}`);
}
