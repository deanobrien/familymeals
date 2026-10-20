import { NextResponse } from 'next/server';
import { resolveRequestAuth } from '../../../../../lib/server/auth/request-auth';
import { imageStoreFor } from '../../../../../lib/server/images';
import { isValidImageRef, type ImageKind } from '../../../../../lib/server/images/paths';
import { useSupabaseBackend } from '../../../../../lib/server/supabase/backend';
import { getUploadFiles } from '../../../../../lib/server/uploads/dev-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/uploads/<uploadId>/<page-N.jpg | cover.jpg>: the import review screen's photo previews.
 * Local mode (DATA_BACKEND != supabase): served from the local dev store; id and file name are validated against strict
 * patterns inside the store, so no path can escape it.
 * Supabase mode (D190): the photo lives in the caller's household folder in the private recipe-images bucket; this route
 * answers a signed-in member with a 302 to a short-lived signed URL, 404 when it is not theirs / not there.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string; file: string }> }) {
  const { id, file } = await ctx.params;
  if (useSupabaseBackend()) {
    const kind: ImageKind = file === 'cover.jpg' ? 'cover' : 'page';
    if (!isValidImageRef(kind, id, file)) return new NextResponse('Not found', { status: 404 });
    const who = await resolveRequestAuth(req);
    if (!who.ok) return new NextResponse(who.status === 401 ? 'Unauthorised' : 'Not found', { status: who.status === 401 ? 401 : 404 });
    const url = await imageStoreFor(who.auth).signedUrl(kind, id, file);
    if (!url) return new NextResponse('Not found', { status: 404 });
    return new NextResponse(null, { status: 302, headers: { location: url, 'cache-control': 'private, max-age=60', 'referrer-policy': 'no-referrer' } });
  }
  const data = getUploadFiles().read(id, file);
  if (!data) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(new Uint8Array(data), {
    headers: {
      'content-type': 'image/jpeg',
      'cache-control': 'private, max-age=3600',
      'x-content-type-options': 'nosniff',
      'content-disposition': 'inline',
    },
  });
}
