import 'server-only';
import { getPantryService } from '../pantry/deps';
import { defaultIngredientLookup } from '../pantry/ingredients';
import { loadPlanServices } from '../plan/services';
import { getIngredientCatalogue } from '../refdata/catalogue';
import { getShoppingStore } from '../shopping/store';
import { createMakeNowService, type MakeNowService } from './service';

export function getMakeNowService(householdId: string): MakeNowService {
  return createMakeNowService({
    pantry: getPantryService(householdId),
    shopping: getShoppingStore(),
    ingredients: defaultIngredientLookup(),
    converter: getIngredientCatalogue().converter,
    loadHousehold: async (hh) => {
      const s = await loadPlanServices(hh);
      return { household: s.household, withheldExclusions: s.withheldExclusions ?? 0 };
    },
    now: () => new Date().toISOString(),
  });
}
