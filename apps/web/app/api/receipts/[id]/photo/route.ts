import { NextResponse } from 'next/server';
import { apiError, householdFromUrl, withApi } from '../../../../../lib/server/api/handle';
import { getReceiptPhoto } from '../../../../../lib/server/receipts/service';
import { identityOf, isReceiptId } from '../../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET ?householdId=: the kept receipt photo bytes, read through the CALLER's own image store (so Storage RLS also decides)
 * and returned with the stored content type, so the app can show it with an Authorization header. 404 when the receipt is
 * unknown, belongs to another household, or has no kept photo.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withApi(req, { householdId: householdFromUrl(req) }, async (ctx) => {
    const photo = isReceiptId(id) ? await getReceiptPhoto(id, identityOf(ctx)) : undefined;
    if (!photo) return apiError(404, 'NOT_FOUND', 'No photo for this receipt.');
    return new NextResponse(Buffer.from(photo.bytes), {
      status: 200,
      headers: { 'content-type': photo.contentType, 'cache-control': 'private, max-age=60', 'x-content-type-options': 'nosniff' },
    });
  });
}
