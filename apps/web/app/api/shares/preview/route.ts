import type { NextResponse } from 'next/server';
import { apiError, bodyHousehold, isRecord, json, readJson } from '../../../../lib/server/api/bearer-route';
import { routeShareViewer } from '../../../../lib/server/sharing/callers';
import { respondShare } from '../../../../lib/server/sharing/respond';
import { previewShare } from '../../../../lib/server/sharing/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST { token, householdId? } -> { preview, signedIn }. PUBLIC path (a signed-out visitor may call it); the preview itself decides
 * what each viewer may see: minimal for a signed-out visitor, the recipes for a signed-in person (or when the sharer allowed a
 * public preview). An unknown, expired or revoked token is `{ preview: { kind: 'invalid' } }`, the same answer as any wrong token.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const body = await readJson(req);
  if (!isRecord(body)) return apiError(400, 'BAD_REQUEST', 'Send a JSON object.');
  const who = await routeShareViewer(req, bodyHousehold(body));
  if (!who.ok) return apiError(who.status, who.status === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN', who.message);
  const r = await previewShare(who.viewer, body.token, req);
  return r.ok ? json({ preview: r.preview, signedIn: who.viewer.userId !== null }) : respondShare(r);
}
