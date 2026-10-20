import { getRecipeRepositoryFor } from '../../../lib/recipes/factory';
import { badRequest, bodyHousehold, guarded, isRecord, json, queryHousehold, readJson } from '../../../lib/server/api/bearer-route';
import { getIngredientCatalogue } from '../../../lib/server/refdata/catalogue';
import { callerOf } from '../../../lib/server/cooking/api';
import { withCooking } from '../../../lib/server/cooking/service';
import { buildRecipeList } from '../../../lib/server/recipes/api-views';
import { saveRecipe } from '../../../lib/server/recipes/service';
import { saveResponse } from '../../../lib/server/recipes/save-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/recipes?householdId&q&cuisine&meal&prep&diet&price&tag&collection&sort&page&pageSize (Bearer or cookie). */
export async function GET(req: Request) {
  return guarded(req, queryHousehold(req), {}, async (auth) => {
    const list = await buildRecipeList(getRecipeRepositoryFor(auth.householdId), new URL(req.url).searchParams);
    return json({ ...list, items: await withCooking(callerOf(auth), list.items) });
  });
}

/** POST /api/recipes { householdId?, recipe, force? } -> SaveResult (200 ok, 422 not saved). */
export async function POST(req: Request) {
  const body = await readJson(req);
  return guarded(req, bodyHousehold(body), { write: true }, async (auth) => {
    if (!isRecord(body) || !isRecord(body.recipe)) return badRequest('Send { recipe } as JSON.');
    const result = await saveRecipe(getRecipeRepositoryFor(auth.householdId), getIngredientCatalogue(), null, body.recipe, body.force === true);
    return saveResponse(result);
  });
}
