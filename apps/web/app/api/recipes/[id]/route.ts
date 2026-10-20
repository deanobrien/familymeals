import { getRecipeRepositoryFor } from '../../../../lib/recipes/factory';
import { resolveInitialServings } from '../../../../lib/recipes/initial-servings';
import { badRequest, bodyHousehold, guarded, isRecord, json, notFound, queryHousehold, readJson } from '../../../../lib/server/api/bearer-route';
import { callerOf } from '../../../../lib/server/cooking/api';
import { loadCooking, withCooking } from '../../../../lib/server/cooking/service';
import { getFreshRecipeCalculator } from '../../../../lib/server/calc';
import { getIngredientCatalogue } from '../../../../lib/server/refdata/catalogue';
import { linkSummary } from '../../../../lib/server/recipes/api-views';
import { saveResponse } from '../../../../lib/server/recipes/save-response';
import { saveRecipe } from '../../../../lib/server/recipes/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/recipes/[id]?householdId -> { recipe, cooking, calc, householdServings, linkNames, unlinkedCount }. */
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  return guarded(req, queryHousehold(req), {}, async (auth) => {
    const recipe = UUID.test(id) ? await getRecipeRepositoryFor(auth.householdId).get(id) : null;
    if (!recipe) return notFound('Recipe not found.');
    const calc = (await getFreshRecipeCalculator(auth.householdId)).forRecipe(recipe);
    const caller = callerOf(auth);
    const [withC] = await withCooking(caller, [recipe]);
    const cooking = await loadCooking(caller, id);
    return json({
      recipe: withC ?? recipe,
      cooking: cooking.ok ? cooking.cooking : null,
      calc,
      householdServings: resolveInitialServings(auth.defaultServings),
      ...linkSummary(recipe, getIngredientCatalogue()),
    });
  });
}

/** PUT /api/recipes/[id] { householdId?, recipe, force? } -> SaveResult (200 ok, 404 gone, 422 not saved). */
export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await readJson(req);
  return guarded(req, bodyHousehold(body), { write: true }, async (auth) => {
    if (!UUID.test(id)) return notFound('Recipe not found.');
    if (!isRecord(body) || !isRecord(body.recipe)) return badRequest('Send { recipe } as JSON.');
    const result = await saveRecipe(getRecipeRepositoryFor(auth.householdId), getIngredientCatalogue(), id, body.recipe, body.force === true);
    return saveResponse(result);
  });
}

/** DELETE /api/recipes/[id]?householdId -> { ok: true } or 404. */
export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params;
  return guarded(req, queryHousehold(req), { write: true }, async (auth) => {
    if (!UUID.test(id)) return notFound('Recipe not found.');
    const removed = await getRecipeRepositoryFor(auth.householdId).delete(id);
    return removed ? json({ ok: true }) : notFound('Recipe not found.');
  });
}
