import { NextResponse } from 'next/server';
import { getUploadFiles } from '../../../../../lib/server/uploads/dev-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/uploads/<uploadId>/<page-N.jpg | cover.jpg>: serves recipe photos from the local dev store.
 * Id and file name are validated against strict patterns inside the store, so no path can escape it.
 * TODO(auth): household-scoped access once auth lands; TODO(Supabase Storage): signed URLs.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; file: string }> }) {
  const { id, file } = await ctx.params;
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
