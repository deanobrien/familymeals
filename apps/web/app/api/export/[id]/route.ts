import { NextResponse } from 'next/server';
import { getHouseholdContext } from '../../../../lib/server/auth/household-context';
import { downloadExport } from '../../../../lib/server/export/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/export/<id>: streams the export zip (DX1). Only the user who requested it, while it is unexpired (1 hour,
 * at most 5 downloads) and while they still have the access the scope needs. Unknown, foreign and expired ids all
 * answer the same 404.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const hctx = await getHouseholdContext();
  if (!hctx) return NextResponse.json({ error: 'unauthenticated' }, { status: 401, headers: { 'cache-control': 'no-store' } });
  const res = await downloadExport(hctx, id);
  return res ?? NextResponse.json({ error: 'not_found' }, { status: 404, headers: { 'cache-control': 'no-store' } });
}
