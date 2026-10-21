import { isSessionId } from '@fr/engine/scanner';
import { apiError, guarded, isRecord, json, queryHousehold, readJson } from '../../../../../lib/server/api/bearer-route';
import { desktopStore, errorBody, statusFor } from '../../../../../lib/server/scanner/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET ?householdId=&after=<seq> -> { session, items }: the session's state and the pushes after `after` (the desktop polls this). */
export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return guarded(req, queryHousehold(req), {}, async (auth) => {
    if (!isSessionId(id)) return apiError(404, 'NOT_FOUND', 'Not found.');
    const after = Number(new URL(req.url).searchParams.get('after') ?? 0);
    const r = await desktopStore(auth).status({ householdId: auth.householdId, userId: auth.userId }, id.toLowerCase(), Number.isFinite(after) && after >= 0 ? Math.floor(after) : 0);
    return r.ok ? json({ session: r.session, items: r.items }) : json(errorBody(r.error), statusFor(r.error));
  });
}

/** DELETE: end the session now and delete what the phone sent (also called once the desktop review is confirmed). */
export async function DELETE(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return guarded(req, queryHousehold(req), { write: true }, async (auth) => {
    if (!isSessionId(id)) return apiError(404, 'NOT_FOUND', 'Not found.');
    const r = await desktopStore(auth).revoke({ householdId: auth.householdId, userId: auth.userId }, id.toLowerCase());
    return r.ok ? json({ ok: true }) : json(errorBody(r.error), statusFor(r.error));
  });
}

/** POST { action: 'release' }: let a different phone take over (clears which phone is connected). */
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = await readJson(req);
  return guarded(req, isRecord(body) && typeof body.householdId === 'string' ? body.householdId : undefined, { write: true }, async (auth) => {
    if (!isSessionId(id) || !isRecord(body) || body.action !== 'release') return apiError(400, 'BAD_REQUEST', 'Unknown action.');
    const r = await desktopStore(auth).release({ householdId: auth.householdId, userId: auth.userId }, id.toLowerCase());
    return r.ok ? json({ ok: true }) : json(errorBody(r.error), statusFor(r.error));
  });
}
