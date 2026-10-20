import { getRecipeRepositoryFor } from '../../../../lib/recipes/factory';
import { badRequest, bodyHousehold, guarded, isRecord, json, readJson } from '../../../../lib/server/api/bearer-route';
import { discoverIdSchema, draftDiscover, loadDiscoverHousehold } from '../../../../lib/server/discover/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/discover/draft { householdId?, id } -> DraftOutcome (200 ok: true with the draft and uploadId; 422 ok: false).
 * The draft is held under the caller and saved by POST /api/extract/save after review.
 */
export async function POST(req: Request) {
  const body = await readJson(req);
  return guarded(req, bodyHousehold(body), { write: true }, async (auth) => {
    const id = isRecord(body) ? discoverIdSchema.safeParse(body.id) : null;
    if (!id?.success) return badRequest('That recipe id is not valid.');
    const out = await draftDiscover(
      id.data,
      { userId: auth.userId, householdId: auth.householdId },
      await loadDiscoverHousehold(auth.householdId),
      getRecipeRepositoryFor(auth.householdId),
    );
    return json(out, out.ok ? 200 : 422);
  });
}
