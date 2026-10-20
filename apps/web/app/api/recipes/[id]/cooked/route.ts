import { apiError, bodyHousehold, guarded, isRecord, readJson } from '../../../../../lib/server/api/bearer-route';
import { callerOf, respond } from '../../../../../lib/server/cooking/api';
import { markCooked } from '../../../../../lib/server/cooking/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/recipes/[id]/cooked { householdId?, servings, rating?, note?, notePrivate? } -> { entry, cooking }.
 * "Mark as cooked": history row + the member's rating + a private (default) or household note. 422 with fieldErrors on bad values.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readJson(req);
  return guarded(req, bodyHousehold(body), { write: true }, async (auth) => {
    if (!isRecord(body)) return apiError(400, 'BAD_REQUEST', 'Send a JSON object.');
    return respond(await markCooked(callerOf(auth), id, body));
  });
}
