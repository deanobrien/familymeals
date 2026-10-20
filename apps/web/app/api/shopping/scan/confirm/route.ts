import { NextResponse } from 'next/server';
import { badRequest, householdFromBody, readJsonBody, withApi } from '../../../../../lib/server/api/handle';
import { confirmListScan, isBatchId, parseDestination, sanitiseCommitRows } from '../../../../../lib/server/shopping/list-scan-apply';
import { listScanEnv } from '../../../../../lib/server/shopping/list-scan-env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST JSON { rows, destination, batchId }: the ONLY point where a list scan writes (D264). Idempotent on `batchId`:
 * a double tap or a retry after a lost response re-sends the same ids and nothing is added twice (D266).
 */
export async function POST(req: Request) {
  const body = await readJsonBody(req);
  if (!body) return badRequest('That request could not be read.');
  return withApi(req, { householdId: householdFromBody(body), write: true }, async (ctx) => {
    const env = listScanEnv(ctx.householdId, ctx.userId);
    const dest = parseDestination(body.destination, new Date());
    const clean = sanitiseCommitRows(body.rows, env.cat);
    if ('error' in clean) return badRequest(clean.error);
    if (!dest || !isBatchId(body.batchId)) return badRequest('That request could not be read.');
    const r = await confirmListScan(env, clean.rows, dest, body.batchId);
    return NextResponse.json({ ok: true, message: r.message, listName: r.listName, created: r.created, added: r.added, merged: r.merged, skipped: r.skipped });
  });
}
