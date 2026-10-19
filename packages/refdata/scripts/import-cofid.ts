import XLSX from 'xlsx';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFoods, CofidDatasetSchema, COFID_SOURCE } from '../src/cofid.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const input = process.argv[2] ?? resolve(root, 'data/raw/cofid2021.xlsx');
const output = process.argv[3] ?? resolve(root, 'data/out/cofid.json');

const wb = XLSX.readFile(input);
const sheet = (n: string) => {
  const s = wb.Sheets[n];
  if (!s) throw new Error(`Sheet "${n}" missing; found ${wb.SheetNames.join(', ')}`);
  return XLSX.utils.sheet_to_json<unknown[]>(s, { header: 1, raw: true, defval: null });
};
const foods = buildFoods(sheet('1.3 Proximates'), sheet('1.4 Inorganics'));
const dataset = CofidDatasetSchema.parse({ source: COFID_SOURCE, foods });
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(dataset));
console.log(`Wrote ${foods.length} foods -> ${output}`);
