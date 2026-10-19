import type { PriceObservation, ProductPack, Quantity, RecipeIngredientLine, Unit } from '../../src/contract';
import type { UnitConverter } from '../../src/cost/types';

/** Test double: same-unit, mass (mg/g/kg) and volume (ml/l) only. No density, no count conversion. */
const MASS: Record<string, number> = { mg: 0.001, g: 1, kg: 1000 };
const VOL: Record<string, number> = { ml: 1, l: 1000 };
export const testConverter: UnitConverter = {
  convert(q: Quantity, to: Unit): Quantity | null {
    if (q.value === undefined || q.unit === undefined) return null;
    if (q.unit === to) return { ...q, kind: 'exact' };
    for (const t of [MASS, VOL]) {
      if (t[q.unit] !== undefined && t[to] !== undefined) {
        return { kind: 'exact', value: q.value * t[q.unit]! / t[to]!, unit: to, originalText: q.originalText };
      }
    }
    return null;
  },
};

export const q = (value: number, unit: Unit): Quantity => ({ kind: 'exact', value, unit, originalText: `${value}${unit}` });
export const approx = (label: string, unit?: Unit): Quantity =>
  ({ kind: 'approximate', approxLabel: label, ...(unit ? { unit } : {}), originalText: label });

export const obs = (o: Partial<PriceObservation> & Pick<PriceObservation, 'pricePence' | 'packQuantity'>): PriceObservation =>
  ({ kind: 'generic_estimate', observedOn: '2026-10-01', source: 'test', ...o });

export const pack = (id: string, ingredientId: string, quantity: Quantity, name = id): ProductPack =>
  ({ id, name, ingredientId, quantity });

export const line = (id: string, ingredientId: string | undefined, quantity: Quantity, order = 0, optional = false): RecipeIngredientLine =>
  ({ id, recipeId: 'r1', ...(ingredientId ? { ingredientId } : {}), quantity, optional, order });
