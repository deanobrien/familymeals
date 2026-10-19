import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadSeed, PACKAGE_ROOT } from '../src/load.js';

const { ingredients, prices } = loadSeed();
const out = resolve(PACKAGE_ROOT, 'data/out');
mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, 'ingredients.json'), JSON.stringify(ingredients, null, 2));
writeFileSync(resolve(out, 'prices.json'), JSON.stringify(prices, null, 2));
console.log(`ingredients=${ingredients.length} prices=${prices.length}`);
