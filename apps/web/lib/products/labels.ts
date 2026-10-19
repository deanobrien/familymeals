// Display labels for product data (client-safe).
import type { Product } from './types';

export const ALLERGEN_LABEL: Record<string, string> = {
  celery: 'Celery', cereals_gluten: 'Cereals containing gluten', crustaceans: 'Crustaceans', eggs: 'Eggs', fish: 'Fish',
  lupin: 'Lupin', milk: 'Milk', molluscs: 'Molluscs', mustard: 'Mustard', peanuts: 'Peanuts', sesame: 'Sesame',
  soya: 'Soya', sulphites: 'Sulphites', tree_nuts: 'Tree nuts',
};

export const allergenLabel = (g: string): string => ALLERGEN_LABEL[g] ?? g;

export interface NutritionLine { label: string; text: string }

const LABEL: Record<string, string> = {
  energy_kcal: 'Energy', protein: 'Protein', carbohydrate: 'Carbohydrate', sugars: 'of which sugars', fat: 'Fat',
  saturates: 'of which saturates', fibre: 'Fibre', salt: 'Salt',
};

/** The per-100 table the review card shows. Unknown is "not on the record", never 0. */
export function nutritionLines(p: Product): NutritionLine[] {
  if (p.nutrition.per100.length === 0) return [];
  return p.nutrition.per100
    .filter((n) => n.nutrient in LABEL)
    .map((n) => ({
      label: LABEL[n.nutrient]!,
      text:
        n.value === undefined
          ? 'not on the record'
          : `${n.value} ${n.unit}${n.estimate || p.nutrition.derived.includes(n.nutrient) ? ' (calculated)' : ''}`,
    }));
}
