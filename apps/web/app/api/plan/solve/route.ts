import { NextResponse } from 'next/server';
import { failureResponse, planPost } from '../../../../lib/server/plan/api';
import { solvePlanRequest } from '../../../../lib/server/plan/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST { householdId, prompt, weekStart, request }: solve the (edited) constraints. No AI call; the server re-validates `request`. */
export async function POST(req: Request) {
  return planPost(req, { write: false }, async (_ctx, svc, body) => {
    const res = await solvePlanRequest(svc, typeof body.prompt === 'string' ? body.prompt : '', typeof body.weekStart === 'string' ? body.weekStart : '', body.request);
    return res.ok ? NextResponse.json({ proposal: res.proposal }) : failureResponse(res);
  });
}
