import { NextResponse } from 'next/server';
import { badRequest, householdFromBody, readJsonBody, withApi } from '../../../../../lib/server/api/handle';
import { parseVoiceTranscript } from '../../../../../lib/server/shopping/voice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST JSON { transcript, householdId? } -> { rows, truncated } (P2-A, D395). The device did the speech-to-text; this reads
 * the text into reviewable rows and writes NOTHING. The reviewed rows are added through /api/shopping/scan/confirm
 * (idempotent on its batchId). The transcript is never logged or stored.
 */
export async function POST(req: Request) {
  const body = await readJsonBody(req);
  if (!body) return badRequest('That request could not be read.');
  return withApi(req, { householdId: householdFromBody(body) }, async () => {
    const r = parseVoiceTranscript(body.transcript);
    if (!r.ok) return badRequest(r.message);
    return NextResponse.json({ rows: r.rows, truncated: r.truncated }, { headers: { 'cache-control': 'private, no-store' } });
  });
}
