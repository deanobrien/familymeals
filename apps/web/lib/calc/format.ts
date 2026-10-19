// Client-safe formatting for calculated cost / nutrition. Rule everywhere: unknown is never shown as 0.
import type { CalculatedNutrient } from '@fr/engine/nutrition';
import type { NutrientKey, PriceKind } from '../recipes/types';

export const PRICE_KIND_LABEL: Record<PriceKind, string> = {
  user_confirmed: 'your price',
  receipt: 'receipt price',
  retailer_verified: 'retailer price',
  generic_estimate: 'estimate',
};

export const NUTRIENT_DISPLAY: ReadonlyArray<{ key: NutrientKey; label: string }> = [
  { key: 'energy_kcal', label: 'Energy' },
  { key: 'protein', label: 'Protein' },
  { key: 'carbohydrate', label: 'Carbohydrate' },
  { key: 'sugars', label: 'of which sugars' },
  { key: 'fat', label: 'Fat' },
  { key: 'saturates', label: 'of which saturates' },
  { key: 'fibre', label: 'Fibre' },
  { key: 'salt', label: 'Salt' },
];

export type NutrientLike = Pick<CalculatedNutrient, 'status' | 'value' | 'unit' | 'estimate'> &
  Partial<Pick<CalculatedNutrient, 'incomplete' | 'lowerBound'>>;

export interface NutrientCell {
  text: string;
  unknown: boolean;
  estimate: boolean;
  /** Extra context for an unknown value, e.g. the sum of the known parts. */
  note?: string;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** `multiplier` converts per-serving values to another basis (servings for per-recipe, days for weekly totals...). */
export function nutrientCell(n: NutrientLike | undefined, multiplier = 1): NutrientCell {
  if (!n) return { text: 'Unknown', unknown: true, estimate: false };
  if (n.status === 'zero') return { text: `0 ${n.unit}`, unknown: false, estimate: n.estimate };
  if (n.status === 'known' && typeof n.value === 'number' && Number.isFinite(n.value)) {
    return { text: `${round1(n.value * multiplier)} ${n.unit}`, unknown: false, estimate: n.estimate };
  }
  if (n.status === 'unavailable') return { text: '—', unknown: true, estimate: false };
  const note =
    n.incomplete && typeof n.lowerBound === 'number' && n.lowerBound > 0
      ? `at least ${round1(n.lowerBound * multiplier)} ${n.unit} from the known ingredients`
      : undefined;
  return { text: 'Unknown', unknown: true, estimate: false, ...(note ? { note } : {}) };
}

/** Printed (on-the-card) nutrition, as another lane's `printedNutrition` field. Shape-compatible with @fr/ai. */
export interface PrintedNutritionLike {
  basis: string;
  values: { nutrient: string; amount: number; unit: string }[];
  note?: string;
}

/** Feature-detect `printedNutrition` on a recipe: shown only when the field exists and has values. */
export function printedNutritionOf(recipe: object): PrintedNutritionLike | null {
  const p = (recipe as { printedNutrition?: unknown }).printedNutrition;
  if (!p || typeof p !== 'object') return null;
  const o = p as Partial<PrintedNutritionLike>;
  if (typeof o.basis !== 'string' || !Array.isArray(o.values) || o.values.length === 0) return null;
  return o as PrintedNutritionLike;
}

const PRINTED_KEYS: Array<[RegExp, NutrientKey]> = [
  [/^(calories|energy|kcal)/i, 'energy_kcal'],
  [/^(sat|of which sat)/i, 'saturates'],
  [/^(fat|total fat)/i, 'fat'],
  [/^(carb|total carb)/i, 'carbohydrate'],
  [/^(sugar|of which sugar)/i, 'sugars'],
  [/^(fib)/i, 'fibre'],
  [/^protein/i, 'protein'],
  [/^salt/i, 'salt'],
];

/** Which nutrient a printed row name refers to (null = not one we show, e.g. kJ). */
export function printedKey(name: string, unit: string): NutrientKey | null {
  if (/^kj$/i.test(unit)) return null;
  for (const [re, key] of PRINTED_KEYS) if (re.test(name.trim())) return key;
  return null;
}
