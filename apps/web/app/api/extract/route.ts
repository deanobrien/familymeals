import { NextResponse } from 'next/server';
import { resolveRequestAuth } from '../../../lib/server/auth/request-auth';
import { runExtraction, type ExtractInput } from '../../../lib/server/import/pipeline';
import { imageStoreFor } from '../../../lib/server/images';
import { recipeSinkFor } from '../../../lib/server/import/sink';
import { runWithDataContext } from '../../../lib/server/supabase/request-data-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_FILES = 6;
/** Must equal experimental.middlewareClientMaxBodySize in next.config.mjs: bigger bodies are truncated before parsing. */
const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;

const bad = (message: string, status = 400) =>
  NextResponse.json({ error: { code: 'BAD_REQUEST', message, retryable: false } }, { status });

/** POST multipart (images[], title?) or JSON { uploadId, title? } to retry stored photos. */
export async function POST(req: Request) {
  let input: ExtractInput;
  let requestedHousehold: string | undefined;
  const type = req.headers.get('content-type') ?? '';
  try {
    if (type.includes('application/json')) {
      const body = (await req.json()) as { uploadId?: unknown; title?: unknown; householdId?: unknown };
      if (typeof body.householdId === 'string') requestedHousehold = body.householdId;
      if (typeof body.uploadId !== 'string') return bad('Missing uploadId.');
      input = { uploadId: body.uploadId, ...(typeof body.title === 'string' ? { title: body.title } : {}) };
    } else {
      const form = await req.formData();
      const files = form.getAll('images').filter((f): f is File => typeof f !== 'string' && f.size > 0);
      if (files.length === 0) return bad('Add at least one photo of the recipe.');
      if (files.length > MAX_FILES) return bad(`You can add up to ${MAX_FILES} pages.`);
      const title = form.get('title');
      const household = form.get('householdId');
      if (typeof household === 'string') requestedHousehold = household;
      input = {
        images: await Promise.all(files.map(async (f) => new Uint8Array(await f.arrayBuffer()))),
        ...(typeof title === 'string' ? { title } : {}),
      };
    }
  } catch {
    // No image content is logged: only the size, so an over-limit upload is diagnosable.
    const length = Number(req.headers.get('content-length') ?? 0);
    console.warn('/api/extract: upload could not be parsed (content-length ' + length + ')');
    if (length > MAX_UPLOAD_BYTES) return bad('Those photos are too large to upload. Try fewer pages or smaller photos.', 413);
    return bad('That upload could not be read. Please try again.');
  }

  // Web session (cookies) or the Android app (Bearer access token); the household must be one the caller belongs to (D102).
  const who = await resolveRequestAuth(req, requestedHousehold);
  if (!who.ok) return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: who.message, retryable: false } }, { status: who.status });
  if (who.auth.readOnly) return bad('This household is read-only while it is pending deletion.', 403);
  input.owner = { userId: who.auth.userId, householdId: who.auth.householdId };

  // Bearer callers have no cookies: the AI settings / price stores must use the context verified above (D213).
  // The ImageStore comes from the same verified context, so a phone upload lands under the caller's household (D190-D196).
  const out = await runWithDataContext(who.auth.dataContext, () =>
    runExtraction(input, { sink: recipeSinkFor(who.auth), images: imageStoreFor(who.auth) }),
  );
  if (!out.ok) {
    return NextResponse.json({ error: out.error, ...(out.uploadId ? { uploadId: out.uploadId } : {}) }, { status: out.status });
  }
  return NextResponse.json({ uploadId: out.uploadId, draft: out.draft, existing: out.existing, ...(out.provider ? { provider: out.provider } : {}) });
}
