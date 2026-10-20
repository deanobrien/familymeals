import { NextResponse } from 'next/server';
import { apiError, householdFromUrl, withApi } from '../../../../lib/server/api/handle';
import { getReview } from '../../../../lib/server/receipts/service';
import { identityOf, isReceiptId } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET ?householdId=: the review model (matches only SUGGESTED: confident ones are pre-selected, never confirmed), the
 * reconciliation of a finished receipt, and whether a kept photo exists (fetch it from `photoPath` with the same auth).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withApi(req, { householdId: householdFromUrl(req) }, async (ctx) => {
    const found = isReceiptId(id) ? await getReview(id, identityOf(ctx)) : undefined;
    if (!found) return apiError(404, 'NOT_FOUND', 'Receipt not found.');
    const { review, reconciliation, imageName, hasPhoto } = found;
    return NextResponse.json({
      review,
      ...(reconciliation ? { reconciliation } : {}),
      ...(imageName ? { imageName } : {}),
      hasPhoto,
      ...(hasPhoto ? { photoPath: `/api/receipts/${id}/photo` } : {}),
    });
  });
}
