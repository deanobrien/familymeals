// Server-side repository factory. Import ONLY from server components, server actions and route handlers.
// TODO(L1): when RECIPE_REPOSITORY=supabase, return the DB-backed implementation.
import { InMemoryRecipeRepository } from './memory-repository';
import type { RecipeRepository } from './repository';
import { loadSeedRecipes } from './seed';

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
  const repo = new InMemoryRecipeRepository(loadSeedRecipes());
  g[KEY] = repo;
  return repo;
}
