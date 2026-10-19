import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIngredients, buildPrices } from './build.js';
import { CofidDatasetSchema, type CofidDataset } from './cofid.js';

export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function loadSeed() {
  const tsv = readFileSync(resolve(PACKAGE_ROOT, 'data/seed/ingredients.tsv'), 'utf8');
  const cofidMap = (JSON.parse(readFileSync(resolve(PACKAGE_ROOT, 'data/seed/cofid-map.json'), 'utf8')) as { map: BuildMap }).map;
  const ingredients = buildIngredients({ tsv, cofidMap });
  return { ingredients, prices: buildPrices(ingredients) };
}
type BuildMap = Record<string, readonly [string, 'exact' | 'proxy']>;

export function loadCofid(path = resolve(PACKAGE_ROOT, 'data/out/cofid.json')): CofidDataset {
  return CofidDatasetSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}
