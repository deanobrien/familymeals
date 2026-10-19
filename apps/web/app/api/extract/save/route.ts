import { NextResponse } from 'next/server';
import { resolveRequestAuth } from '../../../../lib/server/auth/request-auth';
import { saveImport } from '../../../../lib/server/import/pipeline';
import { recipeSinkFor } from '../../../../lib/server/import/sink';
import { getUpload } from '../../../../lib/server/import/upload-store';

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
  // The upload remembers who made it, so the household comes from the caller, never from this body (D102).
  const who = await resolveRequestAuth(req, getUpload(body.uploadId)?.owner?.householdId);
  if (!who.ok) return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: who.message, retryable: false } }, { status: who.status });
  if (who.auth.readOnly) return NextResponse.json({ error: { code: 'READ_ONLY', message: 'This household is read-only while it is pending deletion.', retryable: false } }, { status: 403 });
  const owner = { userId: who.auth.userId, householdId: who.auth.householdId };
  const out = await saveImport({ uploadId: body.uploadId, draft: body.draft as never, owner }, { sink: recipeSinkFor(who.auth) });
  if (!out.ok) return NextResponse.json({ error: out.error, blocking: out.blocking }, { status: out.status });
  return NextResponse.json({ id: out.id });
}
