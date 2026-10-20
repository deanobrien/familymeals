// Builds the environment the handwritten-list apply logic runs in (D264-D266), for a household the caller has already
// been verified against. Shared by the web server actions and the Android JSON API (D346).
import { getIngredientCatalogue } from '../refdata/catalogue';
import { defaultEngineContext } from '../../shopping/engine';
import type { ApplyEnv } from './list-scan-apply';
import { getShoppingStore } from './store';

export function listScanEnv(householdId: string, actor: string): ApplyEnv {
  const cat = getIngredientCatalogue();
  // Decisions use the catalogue converter (density / unit weights), like the shopping repository.
  return { repo: getShoppingStore(), householdId, actor, ctx: { ...defaultEngineContext, converter: cat.converter }, cat };
}
