import { householdFromUrl, withApi } from '../../../../../lib/server/api/handle';
import { getSpendingService } from '../../../../../lib/server/money/deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** GET ?householdId=&weeks=&from=&to=: the spend as a CSV file (one row per receipt/entry per category). Read-only. */
export async function GET(req: Request) {
  return withApi(req, { householdId: householdFromUrl(req) }, async (ctx) => {
    const sp = new URL(req.url).searchParams;
    const weeks = Number(sp.get('weeks'));
    const from = sp.get('from') ?? undefined;
    const to = sp.get('to') ?? undefined;
    const csv = await getSpendingService().csv(ctx.householdId, {
      ...(Number.isFinite(weeks) && weeks > 0 ? { weeks } : {}),
      ...(from && DATE.test(from) ? { from } : {}), ...(to && DATE.test(to) ? { to } : {}),
    });
    return new Response(csv, {
      headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="family-recipes-spend.csv"', 'cache-control': 'no-store' },
    });
  });
}
