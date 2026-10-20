import { NextResponse } from 'next/server';
import { badRequest } from '../../../../lib/server/api/handle';
import { failureResponse, planPost } from '../../../../lib/server/plan/api';
import { generateShopping } from '../../../../lib/server/plan/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST { householdId, planId }: the explicit "Generate shopping list" step. Only an approved, saved plan is accepted. */
export async function POST(req: Request) {
  return planPost(req, { write: true }, async (ctx, svc, body) => {
    if (typeof body.planId !== 'string' || !body.planId) return badRequest('Missing planId.');
    const res = await generateShopping(svc, body.planId, ctx.userId);
    return res.ok ? NextResponse.json(res.value) : failureResponse(res);
  });
}
