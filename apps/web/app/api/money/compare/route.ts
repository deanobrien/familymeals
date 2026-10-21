import { NextResponse } from 'next/server';
import { householdFromUrl, withApi } from '../../../../lib/server/api/handle';
import { getPriceService } from '../../../../lib/server/money/deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET ?householdId=: "cheapest at" badges per item of the active list and per-shop totals with coverage. Read-only. */
export async function GET(req: Request) {
  return withApi(req, { householdId: householdFromUrl(req) }, async (ctx) => {
    return NextResponse.json({ view: await getPriceService().listComparison(ctx.householdId) });
  });
}
