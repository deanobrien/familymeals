// TODO(merge batch 2): TEMPORARY VENDORED COPY of L17a (C:\TFS\FamilyRecipes-lanes\L17a-shopping-state\src).
// Replace with @fr/engine/shopping after merge batch 2 (one-line import change in ../engine.ts). Do not edit.
import type { CanonicalIngredient, Quantity, Unit } from './contract';

/**
 * Injected unit conversion (implemented by @fr/engine core). Returns null when the
 * conversion is not safe (e.g. volume->mass without a density, count->mass without a unit weight).
 */
export interface UnitConverter {
  convert(q: Quantity, to: Unit, ingredient?: CanonicalIngredient): Quantity | null;
}

export interface EngineContext {
  converter: UnitConverter;
  /** Optional lookup so the converter can use density / unit weight. */
  ingredient?: (id: string) => CanonicalIngredient | undefined;
}

export const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/** Tolerance for "equal" comparisons, relative to the required amount. */
export const tolerance = (required: number): number => 1e-6 * Math.max(1, Math.abs(required));

/** A quantity carries a usable number: exact/approximate with value, or a range. */
export function isQuantified(q: Quantity | undefined): q is Quantity {
  if (!q) return false;
  return magnitude(q) !== undefined;
}

/**
 * Single magnitude used for shopping. Ranges use the upper bound ("buy enough"),
 * approximate quantities use their value; to_taste / unparsed have none.
 */
export function magnitude(q: Quantity): number | undefined {
  switch (q.kind) {
    case 'exact':
    case 'approximate':
      return typeof q.value === 'number' && Number.isFinite(q.value) ? q.value : undefined;
    case 'range': {
      const v = q.max ?? q.min;
      return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
    }
    default:
      return undefined;
  }
}

/** Unitless counts are treated as 'item'. */
export const unitOf = (q: Quantity): Unit => q.unit ?? 'item';

export function exactQty(value: number, unit: Unit): Quantity {
  const v = round6(value);
  return { kind: 'exact', value: v, unit, originalText: `${v} ${unit}` };
}

/** Magnitude of q expressed in `to`, or null if not convertible. */
export function valueIn(
  q: Quantity,
  to: Unit,
  ctx: EngineContext,
  ingredientId?: string,
): number | null {
  const m = magnitude(q);
  if (m === undefined) return null;
  const from = unitOf(q);
  if (from === to) return m;
  const ing = ingredientId ? ctx.ingredient?.(ingredientId) : undefined;
  const normalised: Quantity = { kind: 'exact', value: m, unit: from, originalText: q.originalText };
  const r = ctx.converter.convert(normalised, to, ing);
  if (!r || typeof r.value !== 'number' || !Number.isFinite(r.value)) return null;
  return r.value;
}
