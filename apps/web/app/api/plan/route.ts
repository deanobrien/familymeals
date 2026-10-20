import { NextResponse } from 'next/server';
import { householdFromUrl, withApi } from '../../../lib/server/api/handle';
import { getPlanPageData } from '../../../lib/server/plan/handlers';
import { loadPlanServices } from '../../../lib/server/plan/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET ?householdId=&week=YYYY-MM-DD: the week's plan (or an empty draft), recipe catalogue, saved weeks, plus the consent-notice count (D242). */
export async function GET(req: Request) {
  return withApi(req, { householdId: householdFromUrl(req) }, async (ctx) => {
    const svc = await loadPlanServices(ctx.householdId);
    const week = new URL(req.url).searchParams.get('week') ?? undefined;
    const data = await getPlanPageData(svc, week);
    return NextResponse.json({ ...data, withheldExclusions: svc.withheldExclusions ?? 0 });
  });
}
