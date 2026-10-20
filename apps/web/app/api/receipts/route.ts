import { NextResponse } from 'next/server';
import { apiError, badRequest, householdFromUrl, withApi } from '../../../lib/server/api/handle';
import { listReceipts, uploadReceipt } from '../../../lib/server/receipts/service';
import { identityOf } from './_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET ?householdId=: the household's receipts, newest first (ReceiptListEntry[]). Read-only. */
export async function GET(req: Request) {
  return withApi(req, { householdId: householdFromUrl(req) }, async (ctx) => {
    return NextResponse.json({ receipts: await listReceipts(identityOf(ctx)) });
  });
}

/**
 * POST multipart: `receipt` (one photo, max 15 MB like the web upload) + `householdId`. Runs the same pipeline as the web
 * server action (AI parse + match, creates NO purchases) and answers `{ receiptId }`; the app then loads the review (D345).
 */
export async function POST(req: Request) {
  let file: File | null = null;
  let requested: string | undefined;
  try {
    const form = await req.formData();
    const f = form.get('receipt');
    file = typeof f !== 'string' && f ? f : null;
    const hh = form.get('householdId');
    if (typeof hh === 'string') requested = hh;
  } catch {
    return badRequest('That upload could not be read. Please try again.');
  }
  return withApi(req, { householdId: requested, write: true }, async (ctx) => {
    const out = await uploadReceipt(file, identityOf(ctx));
    if (!out.ok) {
      const status = out.status ?? 500;
      return status === 400 || status === 413
        ? badRequest(out.error, status)
        : apiError(status, status === 422 ? 'UNPROCESSABLE' : 'INTERNAL', out.error, {}, out.retryable ?? false);
    }
    return NextResponse.json({ receiptId: out.receiptId });
  });
}
