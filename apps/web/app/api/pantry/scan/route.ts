import { NextResponse } from 'next/server';
import { withApi } from '../../../../lib/server/api/handle';
import { runPantryScan } from '../../../../lib/server/pantry/scan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_FILES = 10;
/** Must equal experimental.middlewareClientMaxBodySize in next.config.mjs: bigger bodies are truncated before parsing. */
const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;

const bad = (message: string, status = 400) =>
  NextResponse.json({ error: { code: 'BAD_REQUEST', message, retryable: false } }, { status });

/**
 * POST multipart: images[] (1-10 JPEG frames / photos; a video is turned into frames in the browser and never
 * uploaded), optional `focus` (the name of one item, for a single close-up photo) and optional `householdId`.
 * Web session (cookies) or the Android app (Bearer access token, D102, D343); the household must be one the caller
 * belongs to, and a read-only household is refused like the other scans. It never writes to the pantry (D83-D84):
 * the reviewed rows are written by /api/pantry/scan/confirm (or the web confirm action).
 */
export async function POST(req: Request) {
  let images: Uint8Array[];
  let focus: string | undefined;
  let requestedHousehold: string | undefined;
  try {
    const form = await req.formData();
    const files = form.getAll('images').filter((f): f is File => typeof f !== 'string' && f.size > 0);
    if (files.length === 0) return bad('Add at least one photo or a short video.');
    if (files.length > MAX_FILES) return bad(`You can scan up to ${MAX_FILES} photos or frames at a time.`);
    images = await Promise.all(files.map(async (f) => new Uint8Array(await f.arrayBuffer())));
    const f = form.get('focus');
    if (typeof f === 'string' && f.trim()) focus = f;
    const household = form.get('householdId');
    if (typeof household === 'string' && household) requestedHousehold = household;
  } catch {
    // No image content is logged: only the size, so an over-limit upload is diagnosable.
    const length = Number(req.headers.get('content-length') ?? 0);
    console.warn('/api/pantry/scan: upload could not be parsed (content-length ' + length + ')');
    if (length > MAX_UPLOAD_BYTES) return bad('Those photos are too large to upload. Try fewer pages or smaller photos.', 413);
    return bad('That upload could not be read. Please try again.');
  }

  return withApi(req, { householdId: requestedHousehold, write: true }, async () => {
    const out = await runPantryScan({ images, ...(focus ? { focus } : {}) });
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
    return NextResponse.json({ rows: out.rows, warnings: out.warnings, ...(out.provider ? { provider: out.provider } : {}) });
  });
}
