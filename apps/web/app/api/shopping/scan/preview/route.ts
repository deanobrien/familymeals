import { NextResponse } from 'next/server';
import { apiError, badRequest, householdFromBody, readJsonBody, withApi } from '../../../../../lib/server/api/handle';
import { isBatchId, parseDestination, previewListScan, sanitiseCommitRows } from '../../../../../lib/server/shopping/list-scan-apply';
import { listScanEnv } from '../../../../../lib/server/shopping/list-scan-env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST JSON { rows, destination, batchId }: what confirming would do. Writes nothing, creates nothing (D264). */
export async function POST(req: Request) {
  const body = await readJsonBody(req);
  if (!body) return badRequest('That request could not be read.');
  return withApi(req, { householdId: householdFromBody(body) }, async (ctx) => {
    const env = listScanEnv(ctx.householdId, ctx.userId);
    const dest = parseDestination(body.destination, new Date());
    const clean = sanitiseCommitRows(body.rows, env.cat);
    if ('error' in clean) return badRequest(clean.error);
    if (!dest || !isBatchId(body.batchId)) return badRequest('That request could not be read.');
    try {
      return NextResponse.json({ preview: await previewListScan(env, clean.rows, dest, body.batchId) });
    } catch {
      return apiError(500, 'INTERNAL', 'Something went wrong. Please try again.', {}, true);
    }
  });
}
