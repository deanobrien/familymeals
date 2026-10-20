import { NextResponse } from 'next/server';
import { apiError, badRequest, householdFromBody, readJsonBody, withApi } from '../../../../../lib/server/api/handle';
import { getPantryService } from '../../../../../lib/server/pantry/deps';
import type { ScanCommitRow } from '../../../../../lib/pantry/scan-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST { householdId, rows: ScanCommitRow[] } -> { lines: ScanPreviewLine[] }: what confirming these reviewed scan rows
 * WOULD do to the pantry (merge into an existing line vs a new line). The same service call as the web
 * previewScanAction (D84, D343). Read-only: nothing is saved. A row the service refuses answers 422 REFUSED.
 */
export async function POST(req: Request) {
  const body = await readJsonBody(req);
  if (!body) return badRequest('Send a JSON object.');
  if (!Array.isArray(body.rows)) return badRequest('Send the reviewed rows as "rows".');
  const rows = body.rows as ScanCommitRow[];
  return withApi(req, { householdId: householdFromBody(body) }, async (ctx) => {
    const res = await getPantryService(ctx.householdId).previewScan(ctx.householdId, rows);
    return res.ok ? NextResponse.json({ lines: res.lines }) : apiError(422, 'REFUSED', res.error);
  });
}
