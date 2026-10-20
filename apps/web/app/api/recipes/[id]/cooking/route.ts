import { guarded, queryHousehold } from '../../../../../lib/server/api/bearer-route';
import { callerOf, respond } from '../../../../../lib/server/cooking/api';
import { loadCooking } from '../../../../../lib/server/cooking/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/recipes/[id]/cooking?householdId -> { cooking: { cookedCount, lastCookedAt, history, myRating, dontSuggest, dontSuggestCount } }. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return guarded(req, queryHousehold(req), {}, async (auth) => respond(await loadCooking(callerOf(auth), id)));
}
