// Generates the PLACEHOLDER app icon / adaptive icon / splash PNGs in ../assets (no dependencies: raw PNG via zlib).
// Replace the files in apps/mobile/assets with real artwork any time; keep the names and sizes (1024x1024).
// Run: node apps/mobile/scripts/gen-placeholder-assets.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 1024;
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
mkdirSync(out, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

/** pixel(x, y) -> [r, g, b, a] */
function png(pixel) {
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < SIZE; x++) {
      const p = pixel(x, y);
      const o = y * (SIZE * 4 + 1) + 1 + x * 4;
      raw[o] = p[0];
      raw[o + 1] = p[1];
      raw[o + 2] = p[2];
      raw[o + 3] = p[3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const GREEN = [46, 125, 50, 255];
const WHITE = [255, 255, 255, 255];
const CLEAR = [0, 0, 0, 0];
const c = SIZE / 2;
// A white "plate" with a green ring: reads as a dish at any size.
const plate = (radius) => (x, y) => {
  const d = Math.hypot(x - c, y - c);
  if (d <= radius * 0.62) return WHITE;
  if (d <= radius * 0.72) return GREEN;
  if (d <= radius) return WHITE;
  return null;
};

const icon = plate(SIZE * 0.34);
writeFileSync(join(out, 'icon.png'), png((x, y) => icon(x, y) ?? GREEN));
// Adaptive icon: transparent foreground inside the 66% safe zone over the background colour set in app.json.
const adaptive = plate(SIZE * 0.3);
writeFileSync(join(out, 'adaptive-icon.png'), png((x, y) => adaptive(x, y) ?? CLEAR));
// Splash: the plate on transparent; the splash background colour comes from app.json.
const splash = plate(SIZE * 0.36);
writeFileSync(join(out, 'splash-icon.png'), png((x, y) => splash(x, y) ?? CLEAR));
console.log(`wrote icon.png, adaptive-icon.png, splash-icon.png to ${out}`);
