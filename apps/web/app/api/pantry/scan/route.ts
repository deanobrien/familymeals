import { NextResponse } from 'next/server';
import { runPantryScan } from '../../../../lib/server/pantry/scan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_FILES = 10;

const bad = (message: string, status = 400) =>
  NextResponse.json({ error: { code: 'BAD_REQUEST', message, retryable: false } }, { status });

/**
 * POST multipart: images[] (1-10 JPEG frames / photos; a video is turned into frames in the browser and never
 * uploaded) and optional `focus` (the name of one item, for a single close-up photo). Read-only: it never writes
 * to the pantry (DECISIONS D83-D84).
 */
export async function POST(req: Request) {
  let images: Uint8Array[];
  let focus: string | undefined;
  try {
    const form = await req.formData();
    const files = form.getAll('images').filter((f): f is File => typeof f !== 'string' && f.size > 0);
    if (files.length === 0) return bad('Add at least one photo or a short video.');
    if (files.length > MAX_FILES) return bad(`You can scan up to ${MAX_FILES} photos or frames at a time.`);
    images = await Promise.all(files.map(async (f) => new Uint8Array(await f.arrayBuffer())));
    const f = form.get('focus');
    if (typeof f === 'string' && f.trim()) focus = f;
  } catch {
    return bad('That upload could not be read. Please try again.');
  }

  const out = await runPantryScan({ images, ...(focus ? { focus } : {}) });
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ rows: out.rows, warnings: out.warnings, ...(out.provider ? { provider: out.provider } : {}) });
}
