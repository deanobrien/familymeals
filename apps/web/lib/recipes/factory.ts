// Server-side repository factory. Import ONLY from server components, server actions and route handlers.
// TODO(L1): when RECIPE_REPOSITORY=supabase, return the DB-backed implementation.
// This is the ONE recipe store: the library (L12), photo import's RecipeSink (L13), the planner and pantry
// recipe sources all read/write it (DECISIONS D30).
import { getRecipeCalculator } from '../server/calc';
import { getIngredientCatalogue } from '../server/refdata/catalogue';
import { InMemoryRecipeRepository } from './memory-repository';
import type { RecipeRepository } from './repository';
import { loadSeedRecipes } from './seed';
import type { RecipeView } from './types';

/** Attach canonical ingredient ids to seed lines via the engine matcher (exact name/alias only; no guessing). */
export function withCanonicalIngredients(recipes: RecipeView[]): RecipeView[] {
  const { matcher } = getIngredientCatalogue();
  return recipes.map((r) => ({
    ...r,
    ingredients: r.ingredients.map((l) => {
      if (l.ingredientId) return l;
      const m = matcher.match(l.name);
      return m.status === 'matched' && m.ingredientId ? { ...l, ingredientId: m.ingredientId } : l;
    }),
  }));
}

const KEY = Symbol.for('fr.recipes.repository');
type Holder = { [KEY]?: RecipeRepository };

/** Process-wide singleton (kept on globalThis so dev-server module reloads do not reset the data). */
export function getRecipeRepository(): RecipeRepository {
  const g = globalThis as Holder;
  const existing = g[KEY];
  if (existing) return existing;
  const kind = process.env.RECIPE_REPOSITORY ?? 'memory';
  if (kind !== 'memory') {
    throw new Error(`RECIPE_REPOSITORY=${kind} is not implemented yet (only "memory")`);
  }
  const repo = new InMemoryRecipeRepository(withCanonicalIngredients(loadSeedRecipes()), getRecipeCalculator());
  g[KEY] = repo;
  return repo;
}

/** Dev/e2e reset back to the seed, in place, so every holder of the shared store sees it (D30, D36). */
export function resetRecipeRepository(): void {
  const repo = (globalThis as Holder)[KEY];
  if (repo instanceof InMemoryRecipeRepository) repo.resetTo(withCanonicalIngredients(loadSeedRecipes()));
}
