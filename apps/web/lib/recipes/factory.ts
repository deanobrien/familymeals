// Server-side repository factory. Import ONLY from server components, server actions and route handlers.
// DATA_BACKEND=supabase (+ Supabase env) selects the DB-backed implementation (lib/server/supabase, DECISIONS D50-D59).
// This is the ONE recipe store: the library (L12), photo import's RecipeSink (L13), the planner and pantry
// recipe sources all read/write it (DECISIONS D30).
import { MOCK_HOUSEHOLD_ID } from '../server/auth/mock';
import { summariserForHousehold } from '../server/calc/household';
import { getIngredientCatalogue } from '../server/refdata/catalogue';
import { createSupabaseRecipeRepository, useSupabaseBackend } from '../server/supabase/backend';
import { InMemoryRecipeRepository } from './memory-repository';
import type { RecipeInput, RecipeQuery } from './schema';
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
const BY_HOUSEHOLD = Symbol.for('fr.recipes.repositories');
type Holder = { [KEY]?: RecipeRepository; [BY_HOUSEHOLD]?: Map<string, InMemoryRecipeRepository> };

/** The in-memory library of ONE household (D160): every household, demo or e2e sandbox, gets a private copy of the seed. */
function memoryRepositoryFor(householdId: string): InMemoryRecipeRepository {
  const g = globalThis as Holder;
  const map = (g[BY_HOUSEHOLD] ??= new Map<string, InMemoryRecipeRepository>());
  let repo = map.get(householdId);
  if (!repo) map.set(householdId, (repo = new InMemoryRecipeRepository(withCanonicalIngredients(loadSeedRecipes()), summariserForHousehold(householdId))));
  return repo;
}

async function currentHouseholdId(): Promise<string> {
  try {
    // Lazy: next/headers only works inside a request; outside one (tests, scripts) the demo household applies.
    const { getHouseholdContext } = await import('../server/auth/household-context');
    return (await getHouseholdContext())?.household.id ?? MOCK_HOUSEHOLD_ID;
  } catch {
    return MOCK_HOUSEHOLD_ID;
  }
}

/** Memory mode: resolves the signed-in household per call and delegates to that household's own library. */
class SessionScopedRecipeRepository implements RecipeRepository {
  private async repo(): Promise<RecipeRepository> {
    return memoryRepositoryFor(await currentHouseholdId());
  }
  async list(q: RecipeQuery) { return (await this.repo()).list(q); }
  async get(id: string) { return (await this.repo()).get(id); }
  async create(input: RecipeInput, opts?: { id?: string }) { return (await this.repo()).create(input, opts); }
  async update(id: string, input: RecipeInput) { return (await this.repo()).update(id, input); }
  async delete(id: string) { return (await this.repo()).delete(id); }
  async duplicate(id: string) { return (await this.repo()).duplicate(id); }
  async toggleFavourite(id: string) { return (await this.repo()).toggleFavourite(id); }
  async listTags() { return (await this.repo()).listTags(); }
  async listCuisines() { return (await this.repo()).listCuisines(); }
  async findDuplicates(c: { title: string; ingredientNames?: string[] }, excludeId?: string) { return (await this.repo()).findDuplicates(c, excludeId); }
}

const memoryMode = (): boolean => !useSupabaseBackend() && (process.env.RECIPE_REPOSITORY ?? 'memory') === 'memory';

/**
 * The recipe library of the CURRENT household: Supabase = the caller's RLS-scoped repository; memory = a per-household
 * in-memory library (D160). Process-wide singleton (on globalThis so dev-server module reloads do not reset the data).
 */
export function getRecipeRepository(): RecipeRepository {
  const g = globalThis as Holder;
  const existing = g[KEY];
  if (existing) return existing;
  // Both backends cost recipes through the same household-scoped calculator, computed on read (D100, D101).
  if (useSupabaseBackend()) return (g[KEY] = createSupabaseRecipeRepository(undefined, summariserForHousehold));
  const kind = process.env.RECIPE_REPOSITORY ?? 'memory';
  if (kind !== 'memory') {
    throw new Error(`RECIPE_REPOSITORY=${kind} is not implemented yet (only "memory")`);
  }
  return (g[KEY] = new SessionScopedRecipeRepository());
}

/**
 * The library of a household the caller already knows (planner, pantry, shopping requirements, import sink). Memory
 * mode: that household's own store; Supabase: the signed-in caller's repository (the household is the RLS scope).
 */
export function getRecipeRepositoryFor(householdId: string): RecipeRepository {
  return memoryMode() ? memoryRepositoryFor(householdId) : getRecipeRepository();
}

/** Dev/e2e reset: every household's library back to the seed, in place, so every holder sees it (D30, D36). */
export function resetRecipeRepository(): void {
  const map = (globalThis as Holder)[BY_HOUSEHOLD];
  if (!map) return;
  for (const repo of map.values()) {
    // Duck-typed: after a dev HMR reload the stored instance's class is not this module's class object.
    if (typeof (repo as Partial<InMemoryRecipeRepository>).resetTo === 'function') repo.resetTo(withCanonicalIngredients(loadSeedRecipes()));
  }
}
