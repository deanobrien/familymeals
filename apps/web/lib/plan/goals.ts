// Weekly progress against a person's nutrition goals for the planner (P3-B, D433). Client-safe glue over the engine's pure
// summariseGoals. Descriptive estimate only; the goals themselves are the signed-in person's own data and are passed in,
// never stored in the plan.
import { goalHints, summariseGoals, type GoalCandidate, type GoalHint, type GoalId, type GoalMeal, type GoalsSummary } from '@fr/engine/nutrition';
import type { PlanDoc, RecipeLite } from './types';
import { parseKey } from './ops';
import type { CookedMealLite } from './variety';

/** The signed-in person's own goals as the planner page needs them (null/absent = no consent or none chosen: render nothing). */
export interface MyGoalsView { goals: GoalId[]; portionShare: number }

export interface WeekGoals {
  summary: GoalsSummary;
  hints: GoalHint[];
  /** Recipe meals counted. */
  meals: number;
}

const toMeal = (id: string, date: string, mealType: GoalMeal['mealType'], r: RecipeLite | undefined, recipeId: string): GoalMeal => ({
  id, recipeId, date, mealType, ...(r ? { title: r.title } : {}),
  perServing: r?.nutritionPerServing ?? null, variety: r?.variety ?? null, goals: r?.goals ?? null,
});

/** Saved recipes that could be suggested in a swap: no household exclusion hit, with the meal types they suit. */
export function swapCandidates(recipes: ReadonlyMap<string, RecipeLite>): GoalCandidate[] {
  return [...recipes.values()]
    .filter((r) => r.excludedBy.length === 0)
    .map((r) => ({ recipeId: r.id, title: r.title, mealTypes: r.mealTypes, perServing: r.nutritionPerServing ?? null, variety: r.variety ?? null, goals: r.goals ?? null }));
}

function build(my: MyGoalsView, meals: GoalMeal[], recipes: ReadonlyMap<string, RecipeLite>, hints: boolean): WeekGoals | null {
  if (my.goals.length === 0) return null;
  const summary = summariseGoals(my.goals, meals, { portionShare: my.portionShare });
  return { summary, meals: meals.length, hints: hints ? goalHints(summary.progress, meals, swapCandidates(recipes)) : [] };
}

export function weekGoals(my: MyGoalsView | null | undefined, doc: PlanDoc, recipes: ReadonlyMap<string, RecipeLite>): WeekGoals | null {
  if (!my) return null;
  const meals: GoalMeal[] = [];
  for (const [key, e] of Object.entries(doc.entries)) {
    if (e.kind !== 'recipe') continue; // eating out / leftovers: nothing we can estimate
    const slot = parseKey(key);
    meals.push(toMeal(key, slot.date, slot.mealType, recipes.get(e.recipeId), e.recipeId));
  }
  return build(my, meals, recipes, true);
}

/** Same summary over what was cooked this week (cooking log); no swap hints for meals already eaten. */
export function cookedGoals(my: MyGoalsView | null | undefined, cooked: readonly CookedMealLite[], recipes: ReadonlyMap<string, RecipeLite>): WeekGoals | null {
  if (!my || cooked.length === 0) return null;
  return build(my, cooked.map((c, i) => toMeal(`c${i}`, c.date, 'dinner', recipes.get(c.recipeId), c.recipeId)), recipes, false);
}
