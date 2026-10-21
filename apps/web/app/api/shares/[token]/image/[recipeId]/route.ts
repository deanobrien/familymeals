import { NextResponse } from 'next/server';
import { routeShareViewer } from '../../../../../../lib/server/sharing/callers';
import { shareImageUrl } from '../../../../../../lib/server/sharing/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/shares/<token>/image/<recipeId>: the cover of one recipe in a LIVE share the signed-in caller opened (web cookie or
 * Android Bearer). Answers a 302 to a 2-minute signed URL minted by the caller's OWN client (Storage RLS decides again); anything
 * else (signed out, wrong token, revoked, expired, a recipe outside the share, no photo) is the same plain 404.
 */
export async function GET(req: Request, ctx: { params: Promise<{ token: string; recipeId: string }> }) {
  const { token, recipeId } = await ctx.params;
  const who = await routeShareViewer(req, new URL(req.url).searchParams.get('householdId') ?? undefined);
  if (!who.ok || who.viewer.userId === null) return new NextResponse('Not found', { status: 404 });
  const url = await shareImageUrl(who.viewer, token, recipeId, req);
  if (!url) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(null, {
    status: 302,
    headers: { location: url, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' },
  });
}
