import type { NutrientKey, NutrientValue, ValueStatus } from './types';

export interface NutritionDisplayRow {
  label: string;
  status: ValueStatus;
  value?: number | null;
  unit: string;
  estimate?: boolean;
  source?: string;
}

const NUTRIENT_ROWS: Array<{ key: NutrientKey; label: string; unit: NutrientValue['unit'] }> = [
  { key: 'energy_kcal', label: 'Energy', unit: 'kcal' },
  { key: 'protein', label: 'Protein', unit: 'g' },
  { key: 'carbohydrate', label: 'Carbohydrate', unit: 'g' },
  { key: 'sugars', label: 'of which sugars', unit: 'g' },
  { key: 'fat', label: 'Fat', unit: 'g' },
  { key: 'saturates', label: 'of which saturates', unit: 'g' },
  { key: 'fibre', label: 'Fibre', unit: 'g' },
  { key: 'salt', label: 'Salt', unit: 'g' },
];

/** Table rows for per-serving values scaled by `multiplier` (1 = per serving, servings = per recipe). Missing nutrients are Unknown, never 0. */
export function nutritionRows(values: NutrientValue[], multiplier: number): NutritionDisplayRow[] {
  return NUTRIENT_ROWS.map(({ key, label, unit }) => {
    const v = values.find((n) => n.nutrient === key);
    if (!v) return { label, status: 'unknown', unit };
    return {
      label,
      status: v.status,
      value: v.status === 'known' && v.value != null ? v.value * multiplier : v.value,
      unit: v.unit,
      estimate: v.estimate,
      ...(v.source ? { source: v.source } : {}),
    };
  });
}
