import { apiError, bodyHousehold, guarded, isRecord, readJson } from '../../../../lib/server/api/bearer-route';
import { shareCallerOf } from '../../../../lib/server/sharing/callers';
import { respondShare } from '../../../../lib/server/sharing/respond';
import { saveShareCopy } from '../../../../lib/server/sharing/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST { token, recipeId, householdId? } -> { recipeId, title, imageCopied }: save a copy of one shared recipe to the caller's household. */
export async function POST(req: Request) {
  const body = await readJson(req);
  return guarded(req, bodyHousehold(body), { write: true }, async (auth) => {
    if (!isRecord(body)) return apiError(400, 'BAD_REQUEST', 'Send a JSON object.');
    return respondShare(await saveShareCopy(shareCallerOf(auth), body.token, body.recipeId, req));
  });
}
