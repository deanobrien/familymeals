import { NextResponse } from 'next/server';
import { failureResponse, planPost } from '../../../../lib/server/plan/api';
import { proposePlan } from '../../../../lib/server/plan/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST { householdId, prompt, weekStart }: parse and solve in one call (the app normally uses parse then solve so the user can review the chips). */
export async function POST(req: Request) {
  return planPost(req, { write: false }, async (_ctx, svc, body) => {
    const res = await proposePlan(svc, typeof body.prompt === 'string' ? body.prompt : '', typeof body.weekStart === 'string' ? body.weekStart : '');
    return res.ok ? NextResponse.json({ proposal: res.proposal }) : failureResponse(res);
  });
}
