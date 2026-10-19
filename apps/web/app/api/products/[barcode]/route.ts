import { NextResponse } from 'next/server';
import { resolveRequestAuth } from '../../../../lib/server/auth/request-auth';
import { lookupProduct } from '../../../../lib/server/products/lookup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/products/<barcode>[?householdId=...]: packaged-product lookup (Open Food Facts; D188). Web session (cookies)
 * or the Android app (Bearer token), exactly like /api/extract. Read-only: nothing is stored until the owner confirms an
 * item. Returns { product, match, provider } or { error: { code, message, retryable } }.
 */
export async function GET(req: Request, ctx: { params: Promise<{ barcode: string }> }) {
  const { barcode } = await ctx.params;
  const url = new URL(req.url);
  const who = await resolveRequestAuth(req, url.searchParams.get('householdId') ?? undefined);
  if (!who.ok) return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: who.message, retryable: false } }, { status: who.status });

  const out = await lookupProduct(decodeURIComponent(barcode), { quotaKey: `${who.auth.householdId}` });
  if (!out.ok) {
    return NextResponse.json(
      { error: out.error },
      { status: out.status, headers: { 'cache-control': 'no-store', ...(out.status === 429 ? { 'retry-after': '30' } : {}) } },
    );
  }
  return NextResponse.json(out.lookup, { headers: { 'cache-control': 'private, no-store' } });
}
