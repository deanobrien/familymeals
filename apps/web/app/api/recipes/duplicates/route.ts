import { getRecipeRepositoryFor } from '../../../../lib/recipes/factory';
import { bodyHousehold, guarded, isRecord, json, readJson } from '../../../../lib/server/api/bearer-route';
import { checkDuplicates } from '../../../../lib/server/recipes/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/recipes/duplicates { householdId?, title, names, excludeId? } -> { hits: [{ id, title }] } (invalid input: no hits). Read-only. */
export async function POST(req: Request) {
  const body = await readJson(req);
  return guarded(req, bodyHousehold(body), {}, async (auth) => {
    if (!isRecord(body) || typeof body.title !== 'string' || !Array.isArray(body.names) || !body.names.every((n) => typeof n === 'string')) {
      return json({ hits: [] });
    }
    const excludeId = typeof body.excludeId === 'string' ? body.excludeId : undefined;
    const hits = await checkDuplicates(getRecipeRepositoryFor(auth.householdId), body.title, body.names as string[], excludeId);
    return json({ hits });
  });
}
