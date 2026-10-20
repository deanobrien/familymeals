import { NextResponse } from 'next/server';
import { resolveRequestAuth } from '../../../../lib/server/auth/request-auth';
import { runShoppingListScan } from '../../../../lib/server/shopping/list-scan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_FILES = 4;
/** Must equal experimental.middlewareClientMaxBodySize in next.config.mjs: bigger bodies are truncated before parsing. */
const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;

const bad = (message: string, status = 400) =>
  NextResponse.json({ error: { code: 'BAD_REQUEST', message, retryable: false } }, { status });

/**
 * POST multipart: images[] (1-4 photos of a handwritten shopping list). Read-only: it never writes to any shopping
 * list; the reviewed rows are added by the confirm action (DECISIONS D260-D264). Web session (cookies) or the Android
 * app (Bearer access token), like /api/extract; the household must be one the caller belongs to (D102).
 */
export async function POST(req: Request) {
  let images: Uint8Array[];
  let requestedHousehold: string | undefined;
  try {
    const form = await req.formData();
    const files = form.getAll('images').filter((f): f is File => typeof f !== 'string' && f.size > 0);
    if (files.length === 0) return bad('Add at least one photo of your list.');
    if (files.length > MAX_FILES) return bad(`You can scan up to ${MAX_FILES} photos of a list at a time.`);
    images = await Promise.all(files.map(async (f) => new Uint8Array(await f.arrayBuffer())));
    const household = form.get('householdId');
    if (typeof household === 'string') requestedHousehold = household;
  } catch {
    // No image content is logged: only the size, so an over-limit upload is diagnosable.
    const length = Number(req.headers.get('content-length') ?? 0);
    console.warn('/api/shopping/scan: upload could not be parsed (content-length ' + length + ')');
    if (length > MAX_UPLOAD_BYTES) return bad('Those photos are too large to upload. Try fewer or smaller photos.', 413);
    return bad('That upload could not be read. Please try again.');
  }

  const who = await resolveRequestAuth(req, requestedHousehold);
  if (!who.ok) return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: who.message, retryable: false } }, { status: who.status });
  if (who.auth.readOnly) return bad('This household is read-only while it is pending deletion.', 403);

  const out = await runShoppingListScan({ images });
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ rows: out.rows, warnings: out.warnings, ...(out.title ? { title: out.title } : {}), ...(out.provider ? { provider: out.provider } : {}) });
}
