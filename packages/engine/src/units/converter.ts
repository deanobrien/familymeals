/**
 * Single production adapter over L3 `convertQuantity`. Cost, shopping, pantry and
 * nutrition all depend on these shapes instead of local converter variants.
 * Tests may inject doubles that satisfy the same interfaces.
 */
import type { CanonicalIngredient, Quantity, Unit, Uuid } from '../contract';
import { convertQuantity } from './index';

export type IngredientResolver = (id: Uuid) => CanonicalIngredient | undefined;

/** Returns null when conversion is not safely possible. */
export interface QuantityConverter {
  convert(q: Quantity, to: Unit, ingredient?: CanonicalIngredient | Uuid): Quantity | null;
}

export interface GramsResult {
  grams: number;
  estimate: boolean;
  note?: string;
}

/** Returns null if the quantity cannot be converted to grams safely. */
export interface GramsConverter {
  toGrams(ingredientId: Uuid | undefined, quantity: Quantity): GramsResult | null;
}

function resolve(
  ingredient: CanonicalIngredient | Uuid | undefined,
  lookup: IngredientResolver | undefined,
): CanonicalIngredient | undefined {
  if (ingredient === undefined) return undefined;
  return typeof ingredient === 'string' ? lookup?.(ingredient) : ingredient;
}

/** `ok ? quantity : null`. Ingredient ids are resolved via `lookup` (density / unit weight). */
export function createQuantityConverter(lookup?: IngredientResolver): QuantityConverter {
  return {
    convert(q, to, ingredient) {
      const r = convertQuantity(q, to, resolve(ingredient, lookup));
      return r.ok ? r.quantity : null;
    },
  };
}

/**
 * Grams via L3. `estimate` is true when the conversion went through `unitWeightG`.
 * Ranges are not accepted (null): callers choose their own point (nutrition uses the midpoint).
 */
export function createGramsConverter(lookup?: IngredientResolver): GramsConverter {
  return {
    toGrams(ingredientId, quantity) {
      if (quantity.kind !== 'exact') return null;
      const r = convertQuantity(quantity, 'g', resolve(ingredientId, lookup));
      if (!r.ok || r.quantity.value === undefined) return null;
      return {
        grams: r.quantity.value,
        estimate: r.estimate,
        ...(r.estimate ? { note: 'via unit weight' } : {}),
      };
    },
  };
}
