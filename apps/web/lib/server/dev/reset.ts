import 'server-only';
import { resetRecipeRepository } from '../../recipes/factory';
import { resetPantryServices } from '../pantry/deps';
import { resetPlanServices } from '../plan/services';
import { resetRecipeCalculators } from '../calc';
import { getPriceStore } from '../prices/store';
import { resetMemoryServices } from '../receipts/memory';
import { getShoppingRepository } from '../shopping/repository';

/**
 * Dev/e2e-only reset of every in-memory store (DECISIONS D36). Never available in production: the route
 * handlers call devToolsAllowed() first and answer 404 otherwise.
 */
export function devToolsAllowed(env: { NODE_ENV?: string | undefined } = process.env): boolean {
  return env.NODE_ENV !== 'production';
}

export function resetInMemoryStores(): string[] {
  getShoppingRepository().reset();
  resetPlanServices();
  resetPantryServices();
  resetMemoryServices();
  getPriceStore().reset();
  resetRecipeCalculators();
  resetRecipeRepository();
  return ['shopping', 'plans', 'pantry', 'receipts', 'prices', 'recipes'];
}
