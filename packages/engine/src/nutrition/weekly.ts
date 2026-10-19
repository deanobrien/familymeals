import type { IsoDate, MealType, Uuid } from '../contract';
import { combine, divideNutrient, type Part } from './combine';
import { NUTRIENT_KEYS, NUTRITION_DISCLAIMER, type CalculatedNutrient, type NutrientMap } from './types';

export interface PlannedMealNutrition {
  plannedMealId: Uuid;
  recipeId: Uuid;
  title?: string;
  date: IsoDate;
  mealType?: MealType;
  /** Portions eaten (planned servings of the recipe). */
  servings: number;
  /** Per-serving nutrition of the recipe; undefined if never calculated. */
  perServing?: NutrientMap;
}

export interface WeeklyNutritionSummary {
  disclaimer: string;
  totals: NutrientMap;
  /** totals / dayCount. */
  perDayAverage: NutrientMap;
  /** totals / total servings eaten (average per serving across the plan). */
  perServingAverage: NutrientMap;
  dailyTotals: { date: IsoDate; totals: NutrientMap }[];
  dayCount: number;
  totalServings: number;
  mealsWithoutNutrition: Uuid[];
  calculatedAt: string;
}

function sumMeals(meals: PlannedMealNutrition[], calculatedAt: string): NutrientMap {
  const out = {} as NutrientMap;
  for (const key of NUTRIENT_KEYS) {
    const parts: Part[] = meals.map((m): Part => {
      const name = m.title ?? m.recipeId;
      const n: CalculatedNutrient | undefined = m.perServing?.[key];
      if (!n) {
        return { id: m.plannedMealId, name, status: 'unknown', reason: 'no_nutrition', sources: [], estimate: false, derived: false };
      }
      if (n.status === 'known' || n.status === 'zero') {
        return {
          id: m.plannedMealId, name, status: n.status, value: (n.value ?? 0) * m.servings,
          sources: n.sources, estimate: n.estimate, derived: n.derived,
        };
      }
      return {
        id: m.plannedMealId, name, status: n.status,
        reason: n.status === 'unavailable' ? 'nutrient_unavailable' : 'nutrient_unknown',
        lowerBound: n.lowerBound === undefined ? undefined : n.lowerBound * m.servings,
        sources: n.sources, estimate: n.estimate, derived: n.derived,
      };
    });
    out[key] = combine(key, parts, calculatedAt);
  }
  return out;
}

/**
 * Totals and averages over planned meals. Descriptive only: no adequacy / target comparisons.
 * `dayCount` defaults to the number of distinct dates that have a meal; pass 7 for a fixed week.
 */
export function summariseWeek(
  meals: PlannedMealNutrition[], opts: { dayCount?: number; now?: () => Date } = {},
): WeeklyNutritionSummary {
  const calculatedAt = (opts.now?.() ?? new Date()).toISOString();
  for (const m of meals) {
    if (!(m.servings > 0) || !Number.isFinite(m.servings)) {
      throw new RangeError(`meal ${m.plannedMealId}: servings must be > 0`);
    }
  }
  const dates = [...new Set(meals.map(m => m.date))].sort();
  const dayCount = opts.dayCount ?? dates.length;
  const totalServings = meals.reduce((s, m) => s + m.servings, 0);
  const totals = sumMeals(meals, calculatedAt);
  const div = (map: NutrientMap, d: number): NutrientMap => {
    const o = {} as NutrientMap;
    for (const k of NUTRIENT_KEYS) o[k] = divideNutrient(map[k], d);
    return o;
  };
  return {
    disclaimer: NUTRITION_DISCLAIMER,
    totals,
    perDayAverage: dayCount > 0 ? div(totals, dayCount) : totals,
    perServingAverage: totalServings > 0 ? div(totals, totalServings) : totals,
    dailyTotals: dates.map(date => ({ date, totals: sumMeals(meals.filter(m => m.date === date), calculatedAt) })),
    dayCount, totalServings,
    mealsWithoutNutrition: meals.filter(m => !m.perServing).map(m => m.plannedMealId),
    calculatedAt,
  };
}
