import { NextResponse } from 'next/server';
import { isSessionId } from '@fr/engine/scanner';
import { apiError, guarded, queryHousehold } from '../../../../../../../lib/server/api/bearer-route';
import { desktopStore, errorBody, statusFor } from '../../../../../../../lib/server/scanner/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: one photo the phone pushed, for the signed-in user who started the session only. Never cached. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string; itemId: string }> }) {
  const { id, itemId } = await ctx.params;
  return guarded(req, queryHousehold(req), {}, async (auth) => {
    if (!isSessionId(id) || !isSessionId(itemId)) return apiError(404, 'NOT_FOUND', 'Not found.');
    const store = desktopStore(auth);
    const ctx2 = { householdId: auth.householdId, userId: auth.userId };
    // The photo must belong to a session of this user: `status` is the ownership check (RLS does the same in SQL).
    const s = await store.status(ctx2, id.toLowerCase(), 0);
    if (!s.ok) return NextResponse.json(errorBody(s.error), { status: statusFor(s.error), headers: { 'cache-control': 'private, no-store' } });
    const r = await store.photo(ctx2, itemId.toLowerCase());
    if (!r.ok) return NextResponse.json(errorBody(r.error), { status: statusFor(r.error), headers: { 'cache-control': 'private, no-store' } });
    return new NextResponse(new Uint8Array(r.bytes), {
      headers: { 'content-type': r.mime, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-disposition': 'inline' },
    });
  });
}
