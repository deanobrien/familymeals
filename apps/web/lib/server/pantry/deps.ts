import { getRecipeRepository } from '../../recipes/factory';
import { getIngredientCatalogue } from '../refdata/catalogue';
import { createSupabasePantryRepository, useSupabaseBackend } from '../supabase/backend';
import { defaultIngredientLookup } from './ingredients';
import { InMemoryPantryRepository } from './repository';
import {
  InMemoryLeftoverSource, InMemoryPurchaseEventSource, RepositoryRecipeSummarySource, fixturePurchaseRecords, seedPantryItems,
} from './sources';
import { createPantryService, type PantryService } from './service';

/** household-a from e2e/fixtures/households. TODO: derive from the signed-in session once auth/households merge. */
export const DEMO_HOUSEHOLD_ID = 'a1a1a101-0000-4000-8000-000000000001';
/** Supabase mode: interim SUPABASE_DEFAULT_HOUSEHOLD_ID until the auth lane supplies the session's household. */
export const getCurrentHouseholdId = (): string =>
  useSupabaseBackend() ? (process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID ?? DEMO_HOUSEHOLD_ID) : DEMO_HOUSEHOLD_ID;

const nowIso = (): string => new Date().toISOString();

export function buildDemoPantryService(now: () => string = nowIso): PantryService {
  const ingredients = defaultIngredientLookup();
  const start = now();
  return createPantryService({
    repo: useSupabaseBackend()
      ? createSupabasePantryRepository()
      : new InMemoryPantryRepository({ householdId: DEMO_HOUSEHOLD_ID, items: seedPantryItems(DEMO_HOUSEHOLD_ID, start, ingredients) }),
    recipes: new RepositoryRecipeSummarySource(getRecipeRepository()),
    purchases: new InMemoryPurchaseEventSource(fixturePurchaseRecords(DEMO_HOUSEHOLD_ID, start, ingredients)),
    leftovers: new InMemoryLeftoverSource(now),
    ingredients,
    converter: getIngredientCatalogue().converter,
    now,
  });
}

const KEY = Symbol.for('fr.pantry.service');
type G = typeof globalThis & { [KEY]?: PantryService };

/** Process-wide singleton (survives dev HMR). In-memory only: state resets when the server restarts. */
export function getPantryService(): PantryService {
  const g = globalThis as G;
  return (g[KEY] ??= buildDemoPantryService());
}
