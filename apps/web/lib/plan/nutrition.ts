// Weekly nutrition for the planner (client-safe; pure over the page's recipe data). Descriptive only:
// totals and averages of estimated values. No targets, no adequacy claims (engine NUTRITION_DISCLAIMER applies).
import { summariseWeek, type PlannedMealNutrition, type WeeklyNutritionSummary } from '@fr/engine/nutrition';
import type { PlanDoc, RecipeLite } from './types';
import { parseKey } from './ops';

export interface WeekNutrition {
  summary: WeeklyNutritionSummary;
  /** Recipe meals in the plan. */
  meals: number;
  /** Recipe meals whose recipe has no calculated nutrition at all. */
  mealsWithoutNutrition: number;
}

export function weekNutrition(doc: PlanDoc, recipes: ReadonlyMap<string, RecipeLite>): WeekNutrition | null {
  const meals: PlannedMealNutrition[] = [];
  for (const [key, e] of Object.entries(doc.entries)) {
    if (e.kind !== 'recipe') continue; // eating out / leftovers: nothing we can calculate or have shopped for
    const r = recipes.get(e.recipeId);
    const slot = parseKey(key);
    meals.push({
      plannedMealId: key,
      recipeId: e.recipeId,
      ...(r ? { title: r.title } : {}),
      date: slot.date,
      mealType: slot.mealType,
      servings: e.servings,
      ...(r?.nutritionPerServing ? { perServing: r.nutritionPerServing } : {}),
    });
  }
  if (meals.length === 0) return null;
  const summary = summariseWeek(meals);
  return { summary, meals: meals.length, mealsWithoutNutrition: summary.mealsWithoutNutrition.length };
}
