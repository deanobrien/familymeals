import { apiError, bodyHousehold, guarded, isRecord, readJson } from '../../../../../lib/server/api/bearer-route';
import { callerOf, respond } from '../../../../../lib/server/cooking/api';
import { setDontSuggest } from '../../../../../lib/server/cooking/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/recipes/[id]/dont-suggest { householdId?, value: boolean } -> { cooking }. The planner skips the recipe while any member has it set. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readJson(req);
  return guarded(req, bodyHousehold(body), { write: true }, async (auth) => {
    if (!isRecord(body) || typeof body.value !== 'boolean') return apiError(400, 'BAD_REQUEST', 'Send { value: true | false }.');
    return respond(await setDontSuggest(callerOf(auth), id, body.value));
  });
}
