// Generates the PWA icons in apps/web/public/icons (P3-C, D445). Run from apps/web: `node scripts/make-pwa-icons.mjs`.
// A white plate with a tick on the app's green; the maskable variant keeps all artwork inside the central 80% safe zone.
// The PNGs are committed, so this only needs re-running to change the artwork.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../public/icons');
mkdirSync(out, { recursive: true });

const GREEN = '#2E7D32';
const art = (scale) => `
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
    <circle cx="256" cy="256" r="170" fill="#FFFFFF"/>
    <circle cx="256" cy="256" r="132" fill="${GREEN}"/>
    <path d="M190 262 l50 50 l86 -104" fill="none" stroke="#FFFFFF" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/>
  </g>`;
const svg = (scale, rounded) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="${rounded ? 96 : 0}" fill="${GREEN}"/>${art(scale)}</svg>`;

async function png(name, size, scale, rounded) {
  const buf = await sharp(Buffer.from(svg(scale, rounded))).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
  writeFileSync(resolve(out, name), buf);
  console.log(name, buf.length, 'bytes');
}

await png('icon-192.png', 192, 1, true);
await png('icon-512.png', 512, 1, true);
await png('icon-maskable-512.png', 512, 0.78, false);
await png('apple-touch-icon.png', 180, 0.9, false);
