import { badRequest, bodyHousehold, guarded, isRecord, json, readJson } from '../../../../lib/server/api/bearer-route';
import { discoverSearchSchema, loadDiscoverHousehold, searchDiscover } from '../../../../lib/server/discover/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/discover/search { householdId?, q?, area?, category?, ingredient? } -> DiscoverOutcome (200 for ok true and false). Read-only. */
export async function POST(req: Request) {
  const body = await readJson(req);
  return guarded(req, bodyHousehold(body), {}, async (auth) => {
    if (!isRecord(body)) return badRequest('Send the search as JSON.');
    const parsed = discoverSearchSchema.safeParse(body);
    if (!parsed.success) return badRequest('That search is not valid.');
    return json(await searchDiscover(parsed.data, await loadDiscoverHousehold(auth.householdId)));
  });
}
