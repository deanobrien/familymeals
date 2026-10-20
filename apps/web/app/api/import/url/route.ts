import { NextResponse } from 'next/server';
import { apiError, badRequest, householdFromBody, readJsonBody, withApi } from '../../../../lib/server/api/handle';
import { imageStoreFor } from '../../../../lib/server/images';
import { recipeSinkFor } from '../../../../lib/server/import/sink';
import { fixtureFetchOptions } from '../../../../lib/server/import/url/fixtures';
import { startUrlImport } from '../../../../lib/server/import/url/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/import/url { householdId?, url } -> { uploadId, draft, existing, via, sourceUrl, provider? }.
 * One web page per call (P1-B, D370). The draft is held under the caller and saved by POST /api/extract/save after review,
 * exactly like a photo import. Web and Android both call this route; nothing about it is duplicated in the app.
 */
export async function POST(req: Request) {
  const body = await readJsonBody(req);
  if (!body || typeof body.url !== 'string') return badRequest('Paste the web address of the recipe.');
  const url = body.url;
  return withApi(req, { householdId: householdFromBody(body), write: true }, async (ctx) => {
    const out = await startUrlImport(
      { url, owner: { userId: ctx.userId, householdId: ctx.householdId } },
      {
        sink: recipeSinkFor(ctx.auth),
        images: imageStoreFor(ctx.auth),
        // URL_IMPORT_SOURCE=mock: offline fixture pages for e2e (transport + DNS only; every guard still runs).
        ...(process.env.URL_IMPORT_SOURCE === 'mock' ? { fetch: fixtureFetchOptions() } : {}),
      },
    );
    if (!out.ok) return apiError(out.status, out.error.code, out.error.message, {}, out.error.retryable);
    const rest: Record<string, unknown> = { ...out };
    delete rest.ok;
    return NextResponse.json(rest);
  });
}
