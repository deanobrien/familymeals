import type { CanonicalIngredient, Requirement } from '@fr/domain';
import { aggregateRequirements, type AggregateInput } from '@fr/engine/aggregate';
import type { RecipeRepository } from '../../recipes/repository';
import type { RecipeView } from '../../recipes/types';
import type { PlanDoc } from '../../plan/types';
import { aisleForCategory } from '../../shopping/aisles';
import type { PlanRequirements } from '../../shopping/types';

/** One planned recipe meal (the planner's PlannedMeal / MealRef shape, reduced). */
export interface MealToShop {
  plannedMealId: string;
  recipeId: string;
  servings: number;
}

export { aisleForCategory };

/** Planned meals of a saved plan (recipe slots only), with the planner's plannedMealId convention. */
export function mealsOfPlan(doc: PlanDoc): MealToShop[] {
  return Object.values(doc.entries).flatMap((e, i) =>
    e.kind === 'recipe' ? [{ plannedMealId: `${doc.id}-${i}`, recipeId: e.recipeId, servings: e.servings }] : [],
  );
}

export interface BuiltRequirements {
  requirements: Requirement[];
  /** ingredientId -> aisle. */
  categories: Record<string, string>;
  recipeTitles: Record<string, string>;
}

/**
 * Aggregate the ingredient lines of every planned meal with `@fr/engine/aggregate` (unit-aware, full
 * provenance, servings-scaled). Lines keep their canonical ingredient id when the recipe store matched them.
 */
export async function buildRequirementsForMeals(
  meals: readonly MealToShop[],
  recipes: Pick<RecipeRepository, 'get'>,
  catalogue: { all: readonly CanonicalIngredient[]; get(id: string): CanonicalIngredient | undefined },
): Promise<BuiltRequirements> {
  const cache = new Map<string, RecipeView | null>();
  const inputs: AggregateInput[] = [];
  const recipeTitles: Record<string, string> = {};
  for (const m of meals) {
    if (!cache.has(m.recipeId)) cache.set(m.recipeId, await recipes.get(m.recipeId));
    const r = cache.get(m.recipeId);
    if (!r) continue;
    recipeTitles[r.id] = r.title;
    const scale = r.servings > 0 && m.servings > 0 ? m.servings / r.servings : 1;
    for (const l of r.ingredients) {
      inputs.push({
        line: {
          id: l.id, recipeId: r.id, quantity: l.quantity, optional: l.optional, order: l.order,
          ...(l.ingredientId ? { ingredientId: l.ingredientId } : {}),
        },
        plannedMealId: m.plannedMealId,
        name: l.ingredientId ? (catalogue.get(l.ingredientId)?.name ?? l.name) : l.name,
        scale,
      });
    }
  }
  const aggregated = aggregateRequirements(inputs, catalogue.all);
  const categories: Record<string, string> = {};
  const requirements: Requirement[] = aggregated.map((a) => {
    if (a.ingredientId) categories[a.ingredientId] = aisleForCategory(catalogue.get(a.ingredientId)?.category);
    const displayName = a.displayName.charAt(0).toUpperCase() + a.displayName.slice(1);
    return {
      displayName,
      quantity: a.quantity,
      contributions: a.contributions,
      ...(a.ingredientId ? { ingredientId: a.ingredientId } : {}),
      ...(a.unresolved?.length ? { unresolved: a.unresolved } : {}),
    };
  });
  return { requirements, categories, recipeTitles };
}

export async function requirementsForPlan(
  doc: PlanDoc,
  recipes: Pick<RecipeRepository, 'get'>,
  catalogue: Parameters<typeof buildRequirementsForMeals>[2],
): Promise<PlanRequirements> {
  const built = await buildRequirementsForMeals(mealsOfPlan(doc), recipes, catalogue);
  return { planId: doc.id, planName: `Week of ${doc.weekStart}`, ...built };
}
