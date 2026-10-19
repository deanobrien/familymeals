import { NextResponse } from 'next/server';
import { saveImport } from '../../../../lib/server/import/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST { uploadId, draft } -> finalise + save via the RecipeSink. */
export async function POST(req: Request) {
  let body: { uploadId?: unknown; draft?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'Invalid request.', retryable: false } }, { status: 400 });
  }
  if (typeof body.uploadId !== 'string' || !body.draft || typeof body.draft !== 'object') {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'Invalid request.', retryable: false } }, { status: 400 });
  }
  const out = await saveImport({ uploadId: body.uploadId, draft: body.draft as never });
  if (!out.ok) return NextResponse.json({ error: out.error, blocking: out.blocking }, { status: out.status });
  return NextResponse.json({ id: out.id });
}
