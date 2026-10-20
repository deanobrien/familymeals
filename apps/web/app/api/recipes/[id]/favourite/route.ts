import { getRecipeRepositoryFor } from '../../../../../lib/recipes/factory';
import { bodyHousehold, guarded, json, notFound, readJson } from '../../../../../lib/server/api/bearer-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST /api/recipes/[id]/favourite { householdId? } -> { ok: true, favourite } or 404. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readJson(req);
  return guarded(req, bodyHousehold(body), { write: true }, async (auth) => {
    if (!UUID.test(id)) return notFound('Recipe not found.');
    const r = await getRecipeRepositoryFor(auth.householdId).toggleFavourite(id);
    return r ? json({ ok: true, favourite: r.favourite }) : notFound('Recipe not found.');
  });
}
