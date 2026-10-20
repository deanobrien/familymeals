import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveExportCaller } from '../../../lib/server/export/caller';
import { startExport } from '../../../lib/server/export/service';
import { runWithDataContext } from '../../../lib/server/supabase/request-data-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// `householdId` is only read for a Bearer caller (Android) with several households, and is only ever narrowed to one of
// THEIR memberships; a cookie caller always exports the household their session has active.
const Body = z.object({ scope: z.enum(['member', 'household']), householdId: z.string().max(64).optional() });
const NO_STORE = { 'cache-control': 'no-store' };

/**
 * POST /api/export { scope: 'member' | 'household', householdId? } (DX1). Starts an export for the ACTIVE household: members
 * may export their own data, owners the whole household. Rate limited (1 per user, household and scope per 24 h) and audited
 * in data_export_requests. Answers { id, downloadUrl, expiresAt }; the download link works for 1 hour, only for the same
 * signed-in user. Web session (cookies) or the Android app (`Authorization: Bearer <supabase access token>`, D322).
 * JSON body required: a cross-site HTML form cannot send application/json without a CORS preflight (CSRF).
 */
export async function POST(req: Request) {
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ error: 'unsupported_media_type' }, { status: 415, headers: NO_STORE });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  const caller = await resolveExportCaller(req, parsed.success ? parsed.data.householdId : undefined);
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status, headers: NO_STORE });
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400, headers: NO_STORE });
  const res = await runWithDataContext(caller.dataContext, () => startExport(caller.ctx, parsed.data.scope));
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
