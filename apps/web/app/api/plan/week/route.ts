import { NextResponse } from 'next/server';
import { householdFromUrl, withApi } from '../../../../lib/server/api/handle';
import { loadPlanForWeek } from '../../../../lib/server/plan/handlers';
import { loadPlanServices } from '../../../../lib/server/plan/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET ?householdId=&week=: the saved plan for that week or `{ doc: null }` (used by "reuse previous week"). */
export async function GET(req: Request) {
  return withApi(req, { householdId: householdFromUrl(req) }, async (ctx) => {
    const week = new URL(req.url).searchParams.get('week') ?? '';
    return NextResponse.json({ doc: await loadPlanForWeek(await loadPlanServices(ctx.householdId), week) });
  });
}
