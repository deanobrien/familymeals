import { NextResponse } from 'next/server';
import { failureResponse, planPost } from '../../../../lib/server/plan/api';
import { parsePlanRequest } from '../../../../lib/server/plan/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST { householdId, prompt, weekStart }: "Understand my request", the single AI call. Returns the editable constraints; nothing is solved or saved. */
export async function POST(req: Request) {
  return planPost(req, { write: false }, async (_ctx, svc, body) => {
    const res = await parsePlanRequest(svc, typeof body.prompt === 'string' ? body.prompt : '', typeof body.weekStart === 'string' ? body.weekStart : '');
    return res.ok ? NextResponse.json({ parsed: res.parsed }) : failureResponse(res);
  });
}
