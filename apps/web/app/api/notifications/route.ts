import { apiError, bodyHousehold, guarded, isRecord, queryHousehold, readJson } from '../../../lib/server/api/bearer-route';
import { callerOf, respond } from '../../../lib/server/notifications/http';
import { loadCentre, loadUnread, markRead } from '../../../lib/server/notifications/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/notifications?householdId[&summary=1] -> { centre: { items, unread } } or { unread } (the bell). */
export async function GET(req: Request) {
  const summary = new URL(req.url).searchParams.get('summary') === '1';
  return guarded(req, queryHousehold(req), {}, async (auth) =>
    summary ? respond(await loadUnread(callerOf(auth))) : respond(await loadCentre(callerOf(auth))),
  );
}

/** POST /api/notifications { householdId?, action: 'read', ids } | { action: 'read_all' } -> { unread } */
export async function POST(req: Request) {
  const body = await readJson(req);
  return guarded(req, bodyHousehold(body), {}, async (auth) => {
    if (!isRecord(body)) return apiError(400, 'BAD_REQUEST', 'Send { action } as JSON.');
    if (body.action === 'read') return respond(await markRead(callerOf(auth), body.ids ?? []));
    if (body.action === 'read_all') return respond(await markRead(callerOf(auth)));
    return apiError(400, 'BAD_REQUEST', 'Unknown action.');
  });
}
