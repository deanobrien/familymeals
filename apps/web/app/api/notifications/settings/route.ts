import { apiError, bodyHousehold, guarded, isRecord, queryHousehold, readJson } from '../../../../lib/server/api/bearer-route';
import { callerOf, respond } from '../../../../lib/server/notifications/http';
import { loadSettings, saveSettings } from '../../../../lib/server/notifications/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/notifications/settings?householdId -> { settings, devices } (the caller's own settings). */
export async function GET(req: Request) {
  return guarded(req, queryHousehold(req), {}, async (auth) => respond(await loadSettings(callerOf(auth))));
}

/** POST /api/notifications/settings { householdId?, settings } -> { settings, devices } */
export async function POST(req: Request) {
  const body = await readJson(req);
  return guarded(req, bodyHousehold(body), { write: true }, async (auth) => {
    if (!isRecord(body)) return apiError(400, 'BAD_REQUEST', 'Send { settings } as JSON.');
    return respond(await saveSettings(callerOf(auth), body.settings));
  });
}
