import { NextResponse } from 'next/server';
import { allowIp, clientIp, errorBody, phoneStore, readCredentials, statusFor } from '../../../../../lib/server/scanner/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEADERS = { 'cache-control': 'private, no-store' };
const fail = (code: Parameters<typeof errorBody>[0]) => NextResponse.json(errorBody(code), { status: statusFor(code), headers: HEADERS });

/**
 * POST { sessionId, token, device } -> { ok, purpose, expiresAt, itemCount }. PUBLIC to middleware: the phone is not signed in; the
 * session id + token from the QR code are the credential, checked against the stored hash (P3-C, D447). The first phone to connect
 * claims the session; a second one gets 403 scanner_in_use. Nothing is read or written for the household beyond this session.
 */
export async function POST(req: Request) {
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return fail('invalid_input');
  if (!allowIp(clientIp(req.headers))) return fail('rate_limited');
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail('invalid_input');
  }
  const cred = body && typeof body === 'object' && !Array.isArray(body) ? readCredentials(body as Record<string, unknown>) : null;
  if (!cred) return fail('invalid'); // malformed credentials look exactly like wrong ones
  const r = await phoneStore().connect(cred.sessionId, cred.token, cred.device);
  if (!r.ok) return fail(r.error);
  return NextResponse.json({ ok: true, purpose: r.purpose, expiresAt: r.expiresAt, itemCount: r.itemCount }, { headers: HEADERS });
}
