// Plan cost summary with explicit honesty: unknown prices are "uncosted" (never 0) and known ones are "estimate".
import type { PlanDoc, PlanEntry, RecipeLite } from './types';

export function formatPence(p: number): string {
  return `£${(p / 100).toFixed(2)}`;
}

export type MealCost =
  | { status: 'estimate'; pence: number; /** some ingredients unpriced: a lower bound */ partial?: boolean }
  | { status: 'uncosted' }
  | { status: 'none' };

export function mealCost(entry: PlanEntry, recipes: ReadonlyMap<string, RecipeLite>): MealCost {
  if (entry.kind !== 'recipe') return { status: 'none' }; // eating out / leftovers add no shopping cost
  const r = recipes.get(entry.recipeId);
  if (!r || r.costPerServingPence == null) return { status: 'uncosted' };
  return { status: 'estimate', pence: Math.round(r.costPerServingPence * entry.servings), ...(r.costPartial ? { partial: true } : {}) };
}

export interface WeekCost {
  knownPence: number;
  costedMeals: number;
  uncostedMeals: number;
  /** Costed meals whose recipe has unpriced ingredients (their cost is a lower bound). */
  partialMeals: number;
  /** 'estimate' = every recipe meal costed (still an estimate); 'partial' = some uncosted; 'uncosted' = none costed. */
  status: 'estimate' | 'partial' | 'uncosted' | 'empty';
}

export function weekCost(doc: PlanDoc, recipes: ReadonlyMap<string, RecipeLite>): WeekCost {
  let knownPence = 0;
  let costed = 0;
  let uncosted = 0;
  let partial = 0;
  for (const e of Object.values(doc.entries)) {
    const c = mealCost(e, recipes);
    if (c.status === 'estimate') {
      knownPence += c.pence;
      costed++;
      if (c.partial) partial++;
    } else if (c.status === 'uncosted') uncosted++;
  }
  const status = costed + uncosted === 0 ? 'empty' : uncosted === 0 && partial === 0 ? 'estimate' : costed === 0 ? 'uncosted' : 'partial';
  return { knownPence, costedMeals: costed, uncostedMeals: uncosted, partialMeals: partial, status };
}

export function weekCostLabel(c: WeekCost): string {
  switch (c.status) {
    case 'empty':
      return 'No meals planned yet';
    case 'uncosted':
      return `Uncosted: no price data for ${c.uncostedMeals} meal${c.uncostedMeals === 1 ? '' : 's'}`;
    case 'partial':
      return `At least ${formatPence(c.knownPence)} (estimate); ${c.uncostedMeals > 0 ? `${c.uncostedMeals} meal${c.uncostedMeals === 1 ? '' : 's'} uncosted` : ''}${c.uncostedMeals > 0 && c.partialMeals > 0 ? ', ' : ''}${c.partialMeals > 0 ? `${c.partialMeals} meal${c.partialMeals === 1 ? '' : 's'} with unpriced ingredients` : ''}`;
    case 'estimate':
      return `About ${formatPence(c.knownPence)} (estimate)`;
  }
}
