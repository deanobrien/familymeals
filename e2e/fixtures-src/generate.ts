// Generates fixture PNGs + expected JSON. Run: pnpm --filter @fr/e2e generate (deterministic output)
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RECIPES, type RecipeDef } from './recipes-data.js';
import { RECEIPTS } from './receipts-data.js';
import { HOUSEHOLD_A, HOUSEHOLD_B } from './households-data.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
for (const d of ['recipes', 'receipts', 'households']) mkdirSync(join(root, d), { recursive: true });
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const FONT = 'Georgia, Times New Roman, serif';
const MONO = 'Courier New, Courier, monospace';
const uuid = (n: number) => `c0c0c0c0-0000-4000-8000-${String(n).padStart(12, '0')}`;
const writeJson = (p: string, v: unknown) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n');

function pageSvg(heading: string, lines: string[], blurry: boolean): string {
  const fg = blurry ? '#a9a9a9' : '#222', bg = blurry ? '#d6d2c8' : '#fbf8f1';
  const h = 120 + lines.length * 34 + 60;
  const body = lines.map((l, n) => {
    const head = l !== '' && /^[A-Z ]+$/.test(l);
    return `<text x="60" y="${130 + n * 34}" font-family="${FONT}" font-size="${head ? 20 : 22}" font-weight="${head ? 700 : 400}" fill="${fg}">${esc(l)}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="${h}"><rect width="100%" height="100%" fill="${bg}"/>` +
    `<text x="60" y="80" font-family="${FONT}" font-size="34" font-weight="700" fill="${fg}">${esc(heading)}</text>${body}</svg>`;
}

async function renderRecipe(r: RecipeDef) {
  const files: string[] = [];
  for (let p = 0; p < r.pages.length; p++) {
    const name = r.pages.length > 1 ? `${r.slug}-p${p + 1}.png` : `${r.slug}.png`;
    let img = sharp(Buffer.from(pageSvg(r.pages[p]!.heading, r.pages[p]!.lines, r.style === 'blurry')));
    if (r.style === 'blurry') img = img.blur(4.5).linear(0.55, 70); // soften + crush contrast
    await img.png().toFile(join(root, 'recipes', name));
    files.push(name);
  }
  writeJson(join(root, 'recipes', `${r.slug}.expected.json`), {
    image: files[0], extraPages: files.slice(1), scenario: r.scenario,
    expectedConfidence: r.style === 'blurry' ? 'low' : 'high', diet: r.diet,
    expected: { title: r.title, ...(r.servings ? { servings: r.servings } : {}), ingredients: r.ingredients, steps: r.steps },
  });
}

const pounds = (p: number) => (p < 0 ? '-' : '') + (Math.abs(p) / 100).toFixed(2);
async function renderReceipt(r: (typeof RECEIPTS)[number], idx: number) {
  const rows = r.lines.map((l, n) => {
    const q = l.qty && l.qty > 1 ? `${l.qty} x ` : '';
    const y = 150 + n * 30;
    return `<text x="30" y="${y}" font-family="${MONO}" font-size="19" fill="#111">${esc(q + l.raw)}</text>` +
      `<text x="370" y="${y}" font-family="${MONO}" font-size="19" text-anchor="end" fill="#111">${pounds(l.pence)}</text>`;
  }).join('');
  const y = 150 + r.lines.length * 30 + 20, h = y + 110;
  const rule = '------------------------------';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="${h}"><rect width="100%" height="100%" fill="#fff"/>` +
    `<text x="200" y="45" font-family="${MONO}" font-size="24" font-weight="700" text-anchor="middle" fill="#111">${esc(r.retailer)}</text>` +
    `<text x="200" y="75" font-family="${MONO}" font-size="16" text-anchor="middle" fill="#111">${r.date}  STORE 0042</text>` +
    `<text x="30" y="115" font-family="${MONO}" font-size="16" fill="#111">${rule}</text>${rows}` +
    `<text x="30" y="${y}" font-family="${MONO}" font-size="16" fill="#111">${rule}</text>` +
    `<text x="30" y="${y + 35}" font-family="${MONO}" font-size="22" font-weight="700" fill="#111">TOTAL</text>` +
    `<text x="370" y="${y + 35}" font-family="${MONO}" font-size="22" font-weight="700" text-anchor="end" fill="#111">${pounds(r.totalPence)}</text>` +
    `<text x="200" y="${y + 80}" font-family="${MONO}" font-size="14" text-anchor="middle" fill="#111">THANK YOU - SYNTHETIC TEST RECEIPT</text></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(join(root, 'receipts', `${r.slug}.png`));
  writeJson(join(root, 'receipts', `${r.slug}.expected.json`), {
    image: `${r.slug}.png`, retailer: r.retailer, date: r.date, note: r.note, totalPence: r.totalPence,
    lines: r.lines.map((l, n) => ({
      id: uuid(idx * 100 + n + 1), rawText: l.raw, kind: l.kind ?? 'item', quantity: l.qty ?? 1,
      linePricePence: l.pence, expectedIngredient: l.ing,
    })),
  });
}

for (const r of RECIPES) await renderRecipe(r);
for (const [n, r] of RECEIPTS.entries()) await renderReceipt(r, n + 1);
writeJson(join(root, 'households', 'household-a.json'), HOUSEHOLD_A);
writeJson(join(root, 'households', 'household-b.json'), HOUSEHOLD_B);
console.log(`generated ${RECIPES.length} recipes, ${RECEIPTS.length} receipts, 2 households -> ${root}`);
