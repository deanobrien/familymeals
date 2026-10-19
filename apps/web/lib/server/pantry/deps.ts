import 'server-only';
import { getRecipeRepository } from '../../recipes/factory';
import { getAppContext } from '../context';
import { getIngredientCatalogue } from '../refdata/catalogue';
import { createSupabasePantryRepository, createSupabasePurchaseEventSource, useSupabaseBackend } from '../supabase/backend';
import { PlanLeftoverSource } from '../supabase/household-sources';
import { getMealPlanStore } from '../plan/repository';
import { defaultIngredientLookup } from './ingredients';
import { InMemoryPantryRepository } from './repository';
import {
  InMemoryLeftoverSource, InMemoryPurchaseEventSource, RepositoryRecipeSummarySource, fixturePurchaseRecords, seedPantryItems,
} from './sources';
import { createPantryService, type PantryService } from './service';

/** household-a from e2e/fixtures/households (= the mock-auth demo household). */
export const DEMO_HOUSEHOLD_ID = 'a1a1a101-0000-4000-8000-000000000001';

/** The signed-in household (D35). */
export const getCurrentHouseholdId = async (): Promise<string> => (await getAppContext()).householdId;

const nowIso = (): string => new Date().toISOString();

/** In-memory pantry for one household, seeded with the demo stock (every household gets the demo seed). */
export function buildDemoPantryService(now: () => string = nowIso, householdId: string = DEMO_HOUSEHOLD_ID): PantryService {
  const ingredients = defaultIngredientLookup();
  const start = now();
  const supabase = useSupabaseBackend();
  // Supabase (D127): stock, purchases (purchase_events) and open slots (saved plans) are the household's real data.
  return createPantryService({
    repo: supabase
      ? createSupabasePantryRepository()
      : new InMemoryPantryRepository({ householdId, items: seedPantryItems(householdId, start, ingredients) }),
    recipes: new RepositoryRecipeSummarySource(getRecipeRepository()),
    purchases: supabase
      ? createSupabasePurchaseEventSource()
      : new InMemoryPurchaseEventSource(fixturePurchaseRecords(householdId, start, ingredients)),
    leftovers: supabase ? new PlanLeftoverSource(getMealPlanStore(), now) : new InMemoryLeftoverSource(now),
    ingredients,
    converter: getIngredientCatalogue().converter,
    now,
  });
}

const KEY = Symbol.for('fr.pantry.services');
type G = typeof globalThis & { [KEY]?: Map<string, PantryService> };

/** Per-household process-wide services (survive dev HMR). In-memory only: state resets when the server restarts. */
export function getPantryService(householdId: string): PantryService {
  const g = globalThis as G;
  const map = (g[KEY] ??= new Map<string, PantryService>());
  let svc = map.get(householdId);
  if (!svc) map.set(householdId, (svc = buildDemoPantryService(nowIso, householdId)));
  return svc;
}

export function resetPantryServices(): void {
  (globalThis as G)[KEY] = undefined;
}
