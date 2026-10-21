import { apiError, bodyHousehold, guarded, isRecord, queryHousehold, readJson } from '../../../lib/server/api/bearer-route';
import { shareCallerOf } from '../../../lib/server/sharing/callers';
import { respondShare } from '../../../lib/server/sharing/respond';
import { createShare, listShares, revokeShare } from '../../../lib/server/sharing/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET ?householdId= -> { shares: ShareSummary[] }: the household's links with status and counts (never who opened them). */
export async function GET(req: Request) {
  return guarded(req, queryHousehold(req), {}, async (auth) => respondShare(await listShares(shareCallerOf(auth))));
}

/**
 * POST { householdId?, action: 'create' | 'revoke', ... }
 *   create  { scope: 'recipe'|'collection', recipeIds?, collection?, title?, expiresInDays?: number|null, publicPreview? } -> { share: { id, token, path, expiresAt } }
 *           the token is returned ONCE; only its hash is stored
 *   revoke  { shareId } -> {}
 */
export async function POST(req: Request) {
  const body = await readJson(req);
  return guarded(req, bodyHousehold(body), { write: true }, async (auth) => {
    if (!isRecord(body)) return apiError(400, 'BAD_REQUEST', 'Send a JSON object.');
    const caller = shareCallerOf(auth);
    switch (body.action) {
      case 'create': return respondShare(await createShare(caller, body));
      case 'revoke': return respondShare(await revokeShare(caller, body.shareId));
      default: return apiError(400, 'BAD_REQUEST', 'Unknown action.');
    }
  });
}
