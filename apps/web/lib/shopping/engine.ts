/**
 * Thin interface onto the shopping state engine (lane L17a).
 *
 * TODO(merge batch 2): replace `./_vendor` with `@fr/engine/shopping` - this is the ONLY file that
 * should import from `_vendor`, so the swap is the one-line change below (plus deleting `_vendor/`
 * and re-pointing `defaultEngineContext` at the real @fr/engine UnitConverter).
 */
export * from './_vendor';
export type { Contribution, PurchaseEvent, Quantity, Requirement, Unit, Uuid } from './_vendor/contract';

import type { CanonicalIngredient, Quantity, Unit } from './_vendor/contract';
import type { EngineContext, UnitConverter } from './_vendor';

type Dim = 'mass' | 'volume';
const FACTORS: Partial<Record<Unit, { dim: Dim; f: number }>> = {
  mg: { dim: 'mass', f: 0.001 }, g: { dim: 'mass', f: 1 }, kg: { dim: 'mass', f: 1000 },
  ml: { dim: 'volume', f: 1 }, l: { dim: 'volume', f: 1000 }, tsp: { dim: 'volume', f: 5 },
  tbsp: { dim: 'volume', f: 15 }, cup: { dim: 'volume', f: 240 }, floz: { dim: 'volume', f: 28.4131 },
  pint: { dim: 'volume', f: 568.261 },
};

export const UNIT_LABELS: Record<Unit, string> = {
  mg: 'mg', g: 'g', kg: 'kg', ml: 'ml', l: 'l', tsp: 'tsp', tbsp: 'tbsp', cup: 'cup', floz: 'fl oz',
  pint: 'pint', item: '', clove: 'clove', slice: 'slice', can: 'can', pack: 'pack', bunch: 'bunch',
  sprig: 'sprig', stick: 'stick',
};

/** Units offered by the add / partial forms. */
export const ALL_UNITS: Unit[] = [
  'item', 'g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'pint', 'can', 'pack', 'bunch', 'clove', 'slice', 'sprig', 'stick',
];

/** Units that can be converted to/from `unit` without density data. */
export function compatibleUnits(unit: Unit): Unit[] {
  const d = FACTORS[unit]?.dim;
  if (!d) return [unit];
  return ALL_UNITS.filter((u) => FACTORS[u]?.dim === d);
}

/**
 * Placeholder converter: mass and volume within their own dimension only, never across.
 * TODO(merge batch 2): use the @fr/engine units converter (density / unit weights).
 */
export const basicConverter: UnitConverter = {
  convert(q: Quantity, to: Unit, _ingredient?: CanonicalIngredient): Quantity | null {
    if (typeof q.value !== 'number') return null;
    const from = q.unit ?? 'item';
    if (from === to) return { ...q, unit: to };
    const a = FACTORS[from];
    const b = FACTORS[to];
    if (!a || !b || a.dim !== b.dim) return null;
    const value = (q.value * a.f) / b.f;
    return { kind: 'exact', value, unit: to, originalText: `${value} ${to}` };
  },
};

export const defaultEngineContext: EngineContext = { converter: basicConverter };
