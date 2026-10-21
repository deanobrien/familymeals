import { NextResponse } from 'next/server';
import { apiError, badRequest, householdFromBody, householdFromUrl, readJsonBody, withApi } from '../../../../lib/server/api/handle';
import { getPriceService } from '../../../../lib/server/money/deps';
import { runPriceAction } from '../../../../lib/server/money/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET ?householdId=&ingredientId=: price history and per-shop comparison for one ingredient. Read-only. */
export async function GET(req: Request) {
  return withApi(req, { householdId: householdFromUrl(req) }, async (ctx) => {
    const id = new URL(req.url).searchParams.get('ingredientId') ?? '';
    const view = id ? await getPriceService().history(ctx.householdId, id.slice(0, 80)) : null;
    return view ? NextResponse.json({ view }) : apiError(404, 'NOT_FOUND', 'That ingredient was not found.');
  });
}

/** POST { householdId?, action: 'add', ingredientId, storeId | retailer, pricePence, packValue, packUnit, observedOn? }: a price you saw. */
export async function POST(req: Request) {
  const body = await readJsonBody(req);
  if (!body) return badRequest('Send a JSON object.');
  return withApi(req, { householdId: householdFromBody(body), write: true }, async (ctx) => {
    const r = await runPriceAction(ctx.householdId, body);
    return r.ok ? NextResponse.json(r) : apiError(r.status, r.status === 422 ? 'REFUSED' : 'BAD_REQUEST', r.error);
  });
}
