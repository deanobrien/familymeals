import { guarded, json, queryHousehold } from '../../../../lib/server/api/bearer-route';
import { loadDiscoverFilters } from '../../../../lib/server/discover/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/discover/filters?householdId -> { categories, areas, sourceLabel, withheld }. */
export async function GET(req: Request) {
  return guarded(req, queryHousehold(req), {}, async (auth) => json(await loadDiscoverFilters(auth.householdId)));
}
