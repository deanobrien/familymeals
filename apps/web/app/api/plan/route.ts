import { NextResponse } from 'next/server';
import { householdFromUrl, withApi } from '../../../lib/server/api/handle';
import { getPlanPageData } from '../../../lib/server/plan/handlers';
import { loadCookedWeek } from '../../../lib/server/cooking/service';
import { loadPlanServices } from '../../../lib/server/plan/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET ?householdId=&week=YYYY-MM-DD: the week's plan (or an empty draft), recipe catalogue, saved weeks, plus the consent-notice count (D242). */
export async function GET(req: Request) {
  return withApi(req, { householdId: householdFromUrl(req) }, async (ctx) => {
    const svc = await loadPlanServices(ctx.householdId);
    const week = new URL(req.url).searchParams.get('week') ?? undefined;
    const data = await getPlanPageData(svc, week);
    // Cooked meals this week (P1-A cooking log) turn on the Planned / Cooked toggle in the variety panels (P1-B, D377).
    const cooked = await loadCookedWeek({ householdId: ctx.householdId, client: ctx.auth.dataContext?.client ?? null }, data.doc.weekStart);
    return NextResponse.json({ ...data, ...(cooked?.length ? { cooked } : {}), withheldExclusions: svc.withheldExclusions ?? 0 });
  });
}
