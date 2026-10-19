import type { CanonicalIngredient, Quantity, Requirement, Unit } from '../../src/contract';
import type { EngineContext, UnitConverter } from '../../src/shopping/units';

const MASS: Record<string, number> = { mg: 0.001, g: 1, kg: 1000 };
const VOL: Record<string, number> = { ml: 1, l: 1000, tsp: 5, tbsp: 15, cup: 240, floz: 29.5735, pint: 568.261 };

/** Test double: mass<->mass, volume<->volume, volume<->mass via density, count<->mass via unit weight. */
export const fakeConverter: UnitConverter = {
  convert(q: Quantity, to: Unit, ing?: CanonicalIngredient): Quantity | null {
    const from = q.unit ?? 'item';
    const v = q.value;
    if (v === undefined) return null;
    if (from === to) return { ...q };
    const out = (value: number): Quantity => ({ kind: 'exact', value, unit: to, originalText: q.originalText });
    const toGrams = (): number | null => {
      if (MASS[from] !== undefined) return v * MASS[from]!;
      if (VOL[from] !== undefined && ing?.densityGPerMl) return v * VOL[from]! * ing.densityGPerMl.value;
      if (from === 'item' && ing?.unitWeightG) return v * ing.unitWeightG.value;
      return null;
    };
    if (MASS[to] !== undefined) {
      const g = toGrams();
      return g === null ? null : out(g / MASS[to]!);
    }
    if (VOL[to] !== undefined) {
      if (VOL[from] !== undefined) return out((v * VOL[from]!) / VOL[to]!);
      const g = toGrams();
      if (g === null || !ing?.densityGPerMl) return null;
      return out(g / ing.densityGPerMl.value / VOL[to]!);
    }
    if (to === 'item' && ing?.unitWeightG) {
      const g = toGrams();
      return g === null ? null : out(g / ing.unitWeightG.value);
    }
    return null;
  },
};

export const ingredients: Record<string, CanonicalIngredient> = {
  'ing-flour': { id: 'ing-flour', name: 'flour', category: 'Baking', aliases: [] },
  'ing-milk': { id: 'ing-milk', name: 'milk', category: 'Dairy', aliases: [], densityGPerMl: { value: 1.03, source: 'test' } },
  'ing-onion': { id: 'ing-onion', name: 'onion', category: 'Veg', aliases: [], unitWeightG: { value: 150, source: 'test', estimate: true } },
  'ing-salt': { id: 'ing-salt', name: 'salt', category: 'Baking', aliases: [] },
};

export const ctx: EngineContext = { converter: fakeConverter, ingredient: (id) => ingredients[id] };

export const q = (value: number, unit?: Unit): Quantity =>
  ({ kind: 'exact', value, ...(unit ? { unit } : {}), originalText: `${value}${unit ? ' ' + unit : ''}` });

export const req = (ingredientId: string | undefined, displayName: string, quantity: Quantity): Requirement =>
  ({ ...(ingredientId ? { ingredientId } : {}), displayName, quantity, contributions: [] });

export const T = '2026-10-19T10:00:00Z';

/** Deterministic seeded PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic UUID-shaped ids. */
export function idGen(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-0000-4000-8000-${(++n).toString(16).padStart(12, '0')}`;
}
