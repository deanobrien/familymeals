import { guarded, queryHousehold } from '../../../../lib/server/api/bearer-route';
import { callerOf, respond } from '../../../../lib/server/notifications/http';
import { loadActivity } from '../../../../lib/server/notifications/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/notifications/activity?householdId&limit -> { events } (household activity feed, derived from existing logs). */
export async function GET(req: Request) {
  const limit = Number(new URL(req.url).searchParams.get('limit') ?? 20);
  return guarded(req, queryHousehold(req), {}, async (auth) => respond(await loadActivity(callerOf(auth), Number.isFinite(limit) ? limit : 20)));
}
