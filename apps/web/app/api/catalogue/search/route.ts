import { guarded, json, queryHousehold } from '../../../../lib/server/api/bearer-route';
import { getIngredientCatalogue } from '../../../../lib/server/refdata/catalogue';
import { searchIngredients } from '../../../../lib/server/recipes/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/catalogue/search?q&householdId -> { candidates: [{ id, name }] } (q shorter than 2 characters: none). */
export async function GET(req: Request) {
  return guarded(req, queryHousehold(req), {}, async () => {
    const q = new URL(req.url).searchParams.get('q') ?? '';
    return json({ candidates: searchIngredients(getIngredientCatalogue(), q) });
  });
}
