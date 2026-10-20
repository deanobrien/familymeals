import { getRecipeRepositoryFor } from '../../../../../lib/recipes/factory';
import { bodyHousehold, guarded, json, readJson } from '../../../../../lib/server/api/bearer-route';
import { getIngredientCatalogue } from '../../../../../lib/server/refdata/catalogue';
import { rematchRecipe } from '../../../../../lib/server/recipes/rematch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST /api/recipes/[id]/rematch { householdId? } -> { ok: true, summary } or { ok: false, message } (404 when not found). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readJson(req);
  return guarded(req, bodyHousehold(body), { write: true }, async (auth) => {
    if (!UUID.test(id)) return json({ ok: false, message: 'Recipe not found' }, 404);
    const summary = await rematchRecipe(getRecipeRepositoryFor(auth.householdId), getIngredientCatalogue(), id);
    return summary ? json({ ok: true, summary }) : json({ ok: false, message: 'Recipe not found' }, 404);
  });
}
