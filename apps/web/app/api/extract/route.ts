import { NextResponse } from 'next/server';
import { runExtraction, type ExtractInput } from '../../../lib/server/import/pipeline';

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
  const type = req.headers.get('content-type') ?? '';
  try {
    if (type.includes('application/json')) {
      const body = (await req.json()) as { uploadId?: unknown; title?: unknown };
      if (typeof body.uploadId !== 'string') return bad('Missing uploadId.');
      input = { uploadId: body.uploadId, ...(typeof body.title === 'string' ? { title: body.title } : {}) };
    } else {
      const form = await req.formData();
      const files = form.getAll('images').filter((f): f is File => typeof f !== 'string' && f.size > 0);
      if (files.length === 0) return bad('Add at least one photo of the recipe.');
      if (files.length > MAX_FILES) return bad(`You can add up to ${MAX_FILES} pages.`);
      const title = form.get('title');
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

  const out = await runExtraction(input);
  if (!out.ok) {
    return NextResponse.json({ error: out.error, ...(out.uploadId ? { uploadId: out.uploadId } : {}) }, { status: out.status });
  }
  return NextResponse.json({ uploadId: out.uploadId, draft: out.draft, existing: out.existing, ...(out.provider ? { provider: out.provider } : {}) });
}
