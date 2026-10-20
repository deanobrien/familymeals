import { NextResponse } from 'next/server';
import { resolveRequestAuth } from '../../../../lib/server/auth/request-auth';
import { imageStoreFor } from '../../../../lib/server/images';
import { parseImagePath } from '../../../../lib/server/images/paths';
import { useSupabaseBackend } from '../../../../lib/server/supabase/backend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/images/<household_id>/<kind>/<id>/<file>: a private Storage image for a signed-in member (web cookie session or
 * Android Bearer token, D102). The path is validated against a strict pattern, the caller must be an ACTIVE member of the
 * household in its first segment, and the redirect target is a signed URL minted by the CALLER's own client, so Storage
 * RLS decides as well (belt and braces). The browser gets a 5-minute signed URL, never a public one (D190).
 * Another household's image, or a missing one, is a plain 404 (no existence leak).
 */
export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const parsed = parseImagePath(path.join('/'));
  if (!parsed || !useSupabaseBackend()) return new NextResponse('Not found', { status: 404 });
  const who = await resolveRequestAuth(req, parsed.householdId);
  if (!who.ok) return new NextResponse(who.status === 401 ? 'Unauthorised' : 'Not found', { status: who.status === 401 ? 401 : 404 });
  const url = await imageStoreFor(who.auth).signedUrl(parsed.kind, parsed.id, parsed.file);
  if (!url) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(null, {
    status: 302,
    headers: { location: url, 'cache-control': 'private, max-age=60', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' },
  });
}
