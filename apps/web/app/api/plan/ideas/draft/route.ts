import { NextResponse } from 'next/server';
import { apiError, badRequest } from '../../../../../lib/server/api/handle';
import { startDiscoverDraft } from '../../../../../lib/server/discover/service';
import { planPost } from '../../../../../lib/server/plan/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST { householdId, id }: turn a discovered idea into the same reviewable draft a photo import produces. It is held
 * under the caller's identity; the app reviews it and saves through /api/extract/save (nothing is added to the library here).
 */
export async function POST(req: Request) {
  return planPost(req, { write: true }, async (ctx, svc, body) => {
    if (typeof body.id !== 'string' || !/^\d{1,12}$/.test(body.id)) return badRequest('That recipe id is not valid.');
    const out = await startDiscoverDraft(body.id, { userId: ctx.userId, householdId: ctx.householdId }, svc.household);
    return out.ok ? NextResponse.json({ uploadId: out.uploadId, draft: out.draft, existing: out.existing }) : apiError(422, 'PLAN_REFUSED', out.message);
  });
}
