import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getHouseholdContext } from '../../../lib/server/auth/household-context';
import { startExport } from '../../../lib/server/export/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ scope: z.enum(['member', 'household']) });
const NO_STORE = { 'cache-control': 'no-store' };

/**
 * POST /api/export { scope: 'member' | 'household' } (DX1). Starts an export for the ACTIVE household (never a
 * client-supplied id): members may export their own data, owners the whole household. Rate limited (1 per user,
 * household and scope per 24 h) and audited in data_export_requests. Answers { id, downloadUrl, expiresAt }; the
 * download link works for 1 hour, only for the same signed-in user.
 * JSON body required: a cross-site HTML form cannot send application/json without a CORS preflight (CSRF).
 */
export async function POST(req: Request) {
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ error: 'unsupported_media_type' }, { status: 415, headers: NO_STORE });
  }
  const ctx = await getHouseholdContext();
  if (!ctx) return NextResponse.json({ error: 'unauthenticated' }, { status: 401, headers: NO_STORE });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400, headers: NO_STORE });
  const res = await startExport(ctx, parsed.data.scope);
  if (res.ok) {
    return NextResponse.json(
      { id: res.ticket.id, downloadUrl: `/api/export/${res.ticket.id}`, expiresAt: res.ticket.expiresAt },
      { status: 201, headers: NO_STORE },
    );
  }
  if (res.reason === 'rate_limited') {
    const secs = Math.max(1, Math.ceil((new Date(res.retryAfter).getTime() - Date.now()) / 1000));
    return NextResponse.json({ error: 'rate_limited', retryAfter: res.retryAfter }, { status: 429, headers: { ...NO_STORE, 'retry-after': String(secs) } });
  }
  if (res.reason === 'forbidden') return NextResponse.json({ error: 'forbidden' }, { status: 403, headers: NO_STORE });
  return NextResponse.json({ error: 'unknown' }, { status: 500, headers: NO_STORE });
}
