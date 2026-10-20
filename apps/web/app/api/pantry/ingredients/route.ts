import { NextResponse } from 'next/server';
import { getPantryService } from '../../../../lib/server/pantry/deps';
import { householdFromUrl, withApi } from '../../../../lib/server/api/handle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET ?q=<text>&householdId=: canonical ingredient search for the pantry and scan pickers (Android parity, D340). Read-only. */
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get('q') ?? '').slice(0, 60);
  return withApi(req, { householdId: householdFromUrl(req) }, async (ctx) => {
    const hits = await getPantryService(ctx.householdId).searchIngredients(q);
    return NextResponse.json({ hits });
  });
}
