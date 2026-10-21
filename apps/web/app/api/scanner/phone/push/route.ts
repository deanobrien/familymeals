import { NextResponse } from 'next/server';
import { allowIp, clientIp, errorBody, phoneStore, readCredentials, readPush, statusFor } from '../../../../../lib/server/scanner/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEADERS = { 'cache-control': 'private, no-store' };
const fail = (code: Parameters<typeof errorBody>[0]) => NextResponse.json(errorBody(code), { status: statusFor(code), headers: HEADERS });
/** A 1.5 MB photo is about 2.1 MB of base64; anything bigger is refused before it is read. */
const MAX_BODY = 2_400_000;

/**
 * POST { sessionId, token, device, clientId, kind: 'barcode' | 'photo', barcode?, count?, photo?, mime? } -> { ok, duplicate, itemCount }.
 * PUBLIC to middleware (the phone is not signed in): the QR code's session id + token are the credential (P3-C, D447). `clientId`
 * makes a retried push idempotent. Rate and size caps are enforced here, per IP, and again in the store, per session.
 */
export async function POST(req: Request) {
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return fail('invalid_input');
  if (!allowIp(clientIp(req.headers))) return fail('rate_limited');
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY) return fail('photo_too_large');
  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY) return fail('photo_too_large');
    body = JSON.parse(text);
  } catch {
    return fail('invalid_input');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('invalid_input');
  const rec = body as Record<string, unknown>;
  const cred = readCredentials(rec);
  if (!cred) return fail('invalid');
  const push = readPush(rec);
  if (!push.ok) return fail(push.error);
  const r = await phoneStore().push(cred.sessionId, cred.token, cred.device, push.push);
  if (!r.ok) return fail(r.error);
  return NextResponse.json({ ok: true, duplicate: r.duplicate, itemCount: r.itemCount }, { headers: HEADERS });
}
