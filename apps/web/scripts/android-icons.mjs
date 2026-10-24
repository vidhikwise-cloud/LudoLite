/**
 * Generates Android launcher icons and the splash image.
 *
 * Writes PNGs directly rather than depending on an image library: the mark
 * is four circles and a diamond, which is a few lines of pixel maths, and a
 * native image dependency is a poor trade for that.
 *
 *   node scripts/android-icons.mjs
 *
 * Run after `cap add android`, and again whenever the brand mark changes.
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, '..');
const res = join(webRoot, 'android', 'app', 'src', 'main', 'res');

if (!existsSync(res)) {
  console.error('\n  android/ not found. Run `npx cap add android` first.\n');
  process.exit(1);
}

// --- PNG writer ------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** `pixel(x, y)` returns [r, g, b, a]; alpha lets icons have transparency. */
function writePng(width, height, pixel, outPath) {
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 4);
    row[0] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y);
      row[1 + x * 4] = r;
      row[2 + x * 4] = g;
      row[3 + x * 4] = b;
      row[4 + x * 4] = a;
    }
    rows.push(row);
  }

  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(
    outPath,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

// --- the mark --------------------------------------------------------------

const PAPER = [251, 247, 242, 255];
const INK = [35, 28, 26];
const TOKENS = [
  [214, 64, 69],
  [45, 155, 90],
  [44, 111, 187],
  [232, 166, 28],
];

/**
 * Four tokens around a centre diamond.
 *
 * `scale` is the mark's size as a fraction of the canvas. Adaptive icon
 * foregrounds need a small scale because Android crops them to a circle or a
 * squircle and anything near the edge is lost.
 */
function mark(size, { scale = 0.78, background = PAPER } = {}) {
  const centre = size / 2;
  const unit = (size * scale) / 2;
  const offset = unit * 0.5;
  const radius = unit * 0.42;
  const diamond = unit * 0.3;

  const centres = [
    [centre - offset, centre - offset, TOKENS[0]],
    [centre + offset, centre - offset, TOKENS[1]],
    [centre - offset, centre + offset, TOKENS[2]],
    [centre + offset, centre + offset, TOKENS[3]],
  ];

  return (x, y) => {
    for (const [cx, cy, colour] of centres) {
      const distance = Math.hypot(x - cx, y - cy);
      if (distance <= radius) {
        // A soft inner shade reads as a rounded piece rather than a flat dot.
        const lift = 1 - (distance / radius) * 0.12;
        return [
          Math.round(colour[0] * lift),
          Math.round(colour[1] * lift),
          Math.round(colour[2] * lift),
          255,
        ];
      }
      // Antialias the edge so icons do not look jagged at small sizes.
      if (distance <= radius + 1) {
        const t = radius + 1 - distance;
        return [
          Math.round(colour[0] * t + background[0] * (1 - t)),
          Math.round(colour[1] * t + background[1] * (1 - t)),
          Math.round(colour[2] * t + background[2] * (1 - t)),
          255,
        ];
      }
    }

    if (Math.abs(x - centre) + Math.abs(y - centre) <= diamond) {
      return [INK[0], INK[1], INK[2], 255];
    }

    return background;
  };
}

// --- outputs ---------------------------------------------------------------

/** Android launcher densities, in pixels. */
const LAUNCHER = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192,
};

let written = 0;

for (const [folder, size] of Object.entries(LAUNCHER)) {
  const square = mark(size, { scale: 0.82 });
  writePng(size, size, square, join(res, folder, 'ic_launcher.png'));
  writePng(size, size, square, join(res, folder, 'ic_launcher_round.png'));

  // The adaptive foreground sits on a 108dp canvas where only the middle
  // 72dp is guaranteed visible, so the mark is drawn smaller and the
  // background is transparent.
  const foreground = mark(size, { scale: 0.52, background: [0, 0, 0, 0] });
  writePng(size, size, foreground, join(res, folder, 'ic_launcher_foreground.png'));

  written += 3;
}

// Splash: Capacitor looks for drawable/splash.png plus density variants.
const splashSizes = {
  drawable: 480,
  'drawable-port-mdpi': 480,
  'drawable-port-hdpi': 720,
  'drawable-port-xhdpi': 960,
  'drawable-port-xxhdpi': 1440,
  'drawable-port-xxxhdpi': 1920,
  'drawable-land-mdpi': 480,
  'drawable-land-hdpi': 720,
  'drawable-land-xhdpi': 960,
  'drawable-land-xxhdpi': 1440,
  'drawable-land-xxxhdpi': 1920,
};

for (const [folder, size] of Object.entries(splashSizes)) {
  writePng(size, size, mark(size, { scale: 0.38 }), join(res, folder, 'splash.png'));
  written++;
}

// The adaptive icon's background colour must match the mark's paper.
const colours = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#FBF7F2</color>
    <color name="colorPrimary">#D64045</color>
    <color name="colorPrimaryDark">#B8343A</color>
    <color name="colorAccent">#D64045</color>
</resources>
`;
mkdirSync(join(res, 'values'), { recursive: true });
writeFileSync(join(res, 'values', 'ic_launcher_background.xml'), colours, 'utf8');

console.log(`\n  Wrote ${written} images plus the icon colour resource.`);
console.log('  Run `npx cap sync android` to pick them up.\n');
