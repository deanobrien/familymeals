import type { NutrientKey } from '@fr/domain';
import type { CalculatedNutrient, PriceKind } from './recipesApi';

/** Presentation of calculated cost / nutrition (mirrors apps/web/lib/calc/format.ts). Rule: unknown is never shown as 0. */

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

export interface NutrientCell {
  text: string;
  unknown: boolean;
  estimate: boolean;
  /** Extra context for an unknown value, e.g. the sum of the known parts. */
  note?: string;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** `multiplier` converts per-serving values to another basis (servings for "per recipe"). */
export function nutrientCell(n: CalculatedNutrient | undefined, multiplier = 1): NutrientCell {
  if (!n) return { text: 'Unknown', unknown: true, estimate: false };
  if (n.status === 'zero') return { text: `0 ${n.unit}`, unknown: false, estimate: n.estimate };
  if (n.status === 'known' && typeof n.value === 'number' && Number.isFinite(n.value)) {
    return { text: `${round1(n.value * multiplier)} ${n.unit}`, unknown: false, estimate: n.estimate };
  }
  if (n.status === 'unavailable') return { text: 'Unknown', unknown: true, estimate: false };
  const note =
    n.incomplete && typeof n.lowerBound === 'number' && n.lowerBound > 0
      ? `at least ${round1(n.lowerBound * multiplier)} ${n.unit} from the known ingredients`
      : undefined;
  return { text: 'Unknown', unknown: true, estimate: false, ...(note ? { note } : {}) };
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

/** Integer pence -> "£1.23". */
export function formatPence(p: number): string {
  return `£${(p / 100).toFixed(2)}`;
}

export function formatMinutes(m: number): string {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}
