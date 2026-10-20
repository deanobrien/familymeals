import { NextResponse } from 'next/server';
import { resolveRequestAuth } from '../../../lib/server/auth/request-auth';
import { getBatchResolver, withinPollRate } from '../../../lib/server/products/batch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_CODES = 50;
const err = (status: number, code: string, message: string, retryable: boolean, extra: Record<string, string> = {}) =>
  NextResponse.json({ error: { code, message, retryable } }, { status, headers: { 'cache-control': 'no-store', ...extra } });

/**
 * POST /api/products { codes: string[], retry?: string[], householdId? } : batch product lookup for rapid barcode scanning
 * (BS1, D272). Web session or Android Bearer token, like GET /api/products/<barcode>. Returns at once with
 * { results: { <code>: { status: 'done', lookup } | { status: 'notfound' } | { status: 'pending' } | { status: 'error', error } } }:
 * known products (the household's own snapshots, the recent-lookup cache) are `done` immediately, the rest are queued behind
 * Open Food Facts' rate limit and the client polls this same endpoint with the codes still `pending`. Read-only: nothing
 * is stored.
 */
export async function POST(req: Request) {
  // JSON only: a cross-site form post (text/plain, urlencoded) cannot be made to look like one without a CORS preflight.
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return err(415, 'BAD_REQUEST', 'Send application/json.', false);
  }
  let body: { codes?: unknown; retry?: unknown; householdId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return err(400, 'BAD_REQUEST', 'Send a JSON body with a codes list.', false);
  }
  const codes = Array.isArray(body.codes) ? body.codes.filter((c): c is string => typeof c === 'string') : null;
  if (!codes || codes.length === 0) return err(400, 'BAD_REQUEST', 'Send a non-empty codes list.', false);
  if (codes.length > MAX_CODES) return err(400, 'TOO_MANY', `At most ${MAX_CODES} codes per request.`, false);
  const retry = Array.isArray(body.retry) ? body.retry.filter((c): c is string => typeof c === 'string').slice(0, MAX_CODES) : [];

  const who = await resolveRequestAuth(req, typeof body.householdId === 'string' ? body.householdId : undefined);
  if (!who.ok) return err(who.status, 'UNAUTHENTICATED', who.message, false);
  if (!withinPollRate(who.auth.householdId)) return err(429, 'rate_limited', 'Too many requests. Wait a moment.', true, { 'retry-after': '10' });

  const results = await getBatchResolver().resolve(who.auth.householdId, codes.map((c) => c.slice(0, 20)), retry);
  return NextResponse.json({ results }, { headers: { 'cache-control': 'private, no-store' } });
}
