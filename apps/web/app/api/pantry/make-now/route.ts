import { NextResponse } from 'next/server';
import { getMakeNowService } from '../../../../lib/server/make-now/deps';
import { apiError, badRequest, householdFromBody, householdFromUrl, readJsonBody, withApi } from '../../../../lib/server/api/handle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET ?householdId=&limit=: "What can I make now?" (ranked recipes, coverage, missing items; allergy exclusions applied). Read-only. */
export async function GET(req: Request) {
  return withApi(req, { householdId: householdFromUrl(req) }, async (ctx) => {
    const raw = Number(new URL(req.url).searchParams.get('limit'));
    const view = await getMakeNowService(ctx.householdId).getView(ctx.householdId, Number.isFinite(raw) && raw > 0 ? { limit: raw } : {});
    return NextResponse.json({ view });
  });
}

/** POST { householdId?, action: 'add_missing', recipeId }: add the missing ingredients to the shopping list (idempotent). */
export async function POST(req: Request) {
  const body = await readJsonBody(req);
  if (!body) return badRequest('Send a JSON object.');
  if (body.action !== 'add_missing' || typeof body.recipeId !== 'string' || !body.recipeId) return badRequest('Unknown action.');
  const recipeId = body.recipeId.slice(0, 80);
  return withApi(req, { householdId: householdFromBody(body), write: true }, async (ctx) => {
    const res = await getMakeNowService(ctx.householdId).addMissing(ctx.householdId, ctx.userId, recipeId);
    return res.ok ? NextResponse.json(res) : apiError(422, 'REFUSED', res.error);
  });
}
