import { createHash } from 'node:crypto';
import {
  CanonicalIngredientSchema, PriceObservationSeedSchema,
  type CanonicalIngredientSeed, type PriceObservationSeed,
} from './schemas.js';
import { DENSITIES } from './data/densities.js';
import { UNIT_WEIGHTS } from './data/unit-weights.js';
import { PRICES, PRICE_OBSERVED_ON, PRICE_SOURCE } from './data/prices.js';

/** Fixed namespace so ingredient ids are deterministic across rebuilds (UUIDv5). */
export const INGREDIENT_NAMESPACE = '6f1c1b0e-5a3e-4b7e-9d52-0a3a8f5d8e11';

export function uuidV5(name: string, namespace = INGREDIENT_NAMESPACE): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const h = createHash('sha1').update(ns).update(name).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

export const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export interface BuildInput {
  tsv: string;
  cofidMap: Record<string, readonly [string, 'exact' | 'proxy']>;
}

export function buildIngredients({ tsv, cofidMap }: BuildInput): CanonicalIngredientSeed[] {
  const dens = new Map(DENSITIES.map(([n, v, s]) => [n, { value: v, source: s }]));
  const units = new Map(UNIT_WEIGHTS.map(([n, v, s]) => [n, { value: v, source: s, estimate: true as const }]));
  const rows = tsv.trim().split(/\r?\n/).slice(1);
  const out: CanonicalIngredientSeed[] = [];
  for (const line of rows) {
    const [name, category, aliases, form] = line.split('|');
    if (!name) continue;
    const key = name.trim();
    const slug = slugify(key);
    const map = cofidMap[key];
    out.push(CanonicalIngredientSchema.parse({
      id: uuidV5(slug),
      slug,
      name: key,
      category: category?.trim(),
      aliases: (aliases ?? '').split(';').map((a) => a.trim()).filter(Boolean),
      ...(dens.has(key) ? { densityGPerMl: dens.get(key) } : {}),
      ...(units.has(key) ? { unitWeightG: units.get(key) } : {}),
      ...(form?.trim() ? { form: form.trim() } : {}),
      ...(map ? { cofid: { code: map[0], match: map[1] } } : {}),
    }));
  }
  return out;
}

export function buildPrices(ingredients: readonly CanonicalIngredientSeed[]): PriceObservationSeed[] {
  const byName = new Map(ingredients.map((i) => [i.name, i]));
  return PRICES.map(([name, pence, value, unit]) => {
    const ing = byName.get(name);
    if (!ing) throw new Error(`Price for unknown ingredient "${name}"`);
    return PriceObservationSeedSchema.parse({
      ingredientId: ing.id,
      ingredientName: name,
      pricePence: pence,
      packQuantity: { kind: 'exact', value, unit, originalText: `${value}${unit}` },
      kind: 'generic_estimate',
      observedOn: PRICE_OBSERVED_ON,
      source: PRICE_SOURCE,
    });
  });
}
