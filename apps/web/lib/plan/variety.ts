// "5 a day" and variety for the planner week (P1-B, D376). Client-safe glue over the engine's pure summariseVariety.
// Descriptive estimate only: see VARIETY_DISCLAIMER. `cooked` meals exist only once the cooking lane (P1-A) records them.
import { summariseVariety, type VarietySummary } from '@fr/engine/nutrition';
import type { PlanDoc, RecipeLite } from './types';
import { parseKey } from './ops';

/** A meal that was actually cooked (P1-A cooking log); same shape the planned meals reduce to. */
export interface CookedMealLite { date: string; recipeId: string }

export interface WeekVariety {
  summary: VarietySummary;
  /** Recipe meals counted. */
  meals: number;
}

export function weekVariety(doc: PlanDoc, recipes: ReadonlyMap<string, RecipeLite>): WeekVariety | null {
  const meals = Object.entries(doc.entries).flatMap(([key, e]) => {
    if (e.kind !== 'recipe') return []; // eating out / leftovers: nothing we can estimate
    const r = recipes.get(e.recipeId);
    return [{ id: key, date: parseKey(key).date, ...(r ? { title: r.title } : {}), variety: r?.variety ?? null }];
  });
  if (meals.length === 0) return null;
  return { summary: summariseVariety(meals), meals: meals.length };
}

/** Same summary over what was cooked this week; null when nothing was recorded. */
export function cookedVariety(cooked: readonly CookedMealLite[], recipes: ReadonlyMap<string, RecipeLite>): WeekVariety | null {
  if (cooked.length === 0) return null;
  const meals = cooked.map((c, i) => ({ id: `c${i}`, date: c.date, variety: recipes.get(c.recipeId)?.variety ?? null }));
  return { summary: summariseVariety(meals), meals: meals.length };
}
