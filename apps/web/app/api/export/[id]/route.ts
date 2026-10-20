import { NextResponse } from 'next/server';
import { resolveExportCaller } from '../../../../lib/server/export/caller';
import { downloadExport } from '../../../../lib/server/export/service';
import { runWithDataContext } from '../../../../lib/server/supabase/request-data-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/export/<id>: streams the export zip (DX1). Only the user who requested it, while it is unexpired (1 hour,
 * at most 5 downloads) and while they still have the access the scope needs. Unknown, foreign and expired ids all
 * answer the same 404. Web session (cookies) or the Android app (Bearer access token, D322).
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const caller = await resolveExportCaller(req, undefined, { inferFirst: true });
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status, headers: { 'cache-control': 'no-store' } });
  // The export reads only through `caller.ctx.supabase` (the caller's own client, RLS applies); the data context is installed
  // exactly as in the other Bearer routes (D213) in case any store on the path resolves it.
  const res = await runWithDataContext(caller.dataContext, () => downloadExport(caller.ctx, id));
  return res ?? NextResponse.json({ error: 'not_found' }, { status: 404, headers: { 'cache-control': 'no-store' } });
}
