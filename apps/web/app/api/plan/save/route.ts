import { NextResponse } from 'next/server';
import { badRequest } from '../../../../lib/server/api/handle';
import { failureResponse, planPost, readPlanDoc } from '../../../../lib/server/plan/api';
import { savePlan } from '../../../../lib/server/plan/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST { householdId, doc }: save a draft. Refused (422 + violations) when it breaks a hard constraint. */
export async function POST(req: Request) {
  return planPost(req, { write: true }, async (_ctx, svc, body) => {
    const doc = readPlanDoc(body.doc);
    if (!doc) return badRequest('That plan is not valid.');
    const res = await savePlan(svc, doc);
    return res.ok ? NextResponse.json({ doc: res.value }) : failureResponse(res);
  });
}
