import { NextResponse } from 'next/server';
import { apiError, badRequest, householdFromBody, householdFromUrl, readJsonBody, withApi } from '../../../../lib/server/api/handle';
import { getSpendingService } from '../../../../lib/server/money/deps';
import { runSpendingAction } from '../../../../lib/server/money/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET ?householdId=&weeks=: weekly/monthly budget vs planned estimate vs actual spend, categories, shops, recent entries. Read-only. */
export async function GET(req: Request) {
  return withApi(req, { householdId: householdFromUrl(req) }, async (ctx) => {
    const weeks = Number(new URL(req.url).searchParams.get('weeks'));
    const view = await getSpendingService().spending(ctx.householdId, Number.isFinite(weeks) && weeks > 0 ? { weeks } : {});
    return NextResponse.json({ view });
  });
}

/** POST { householdId?, action: 'add' | 'update' | 'delete' | 'link', ... }: manual spend entries and retailer -> store links. */
export async function POST(req: Request) {
  const body = await readJsonBody(req);
  if (!body) return badRequest('Send a JSON object.');
  return withApi(req, { householdId: householdFromBody(body), write: true }, async (ctx) => {
    const r = await runSpendingAction(ctx.householdId, body);
    return r.ok ? NextResponse.json(r) : apiError(r.status, r.status === 404 ? 'NOT_FOUND' : r.status === 422 ? 'REFUSED' : 'BAD_REQUEST', r.error);
  });
}
