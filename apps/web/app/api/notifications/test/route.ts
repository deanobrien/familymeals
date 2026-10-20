import { bodyHousehold, guarded, readJson } from '../../../../lib/server/api/bearer-route';
import { configuredSenders } from '../../../../lib/server/notifications/config';
import { callerOf, respond } from '../../../../lib/server/notifications/http';
import { sendTest } from '../../../../lib/server/notifications/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/notifications/test { householdId? } -> { outcome: 'sent' | 'no_devices' | 'failed' | 'in_app_only' } (one per 30 s). */
export async function POST(req: Request) {
  const body = await readJson(req);
  return guarded(req, bodyHousehold(body), {}, async (auth) => respond(await sendTest(callerOf(auth), configuredSenders())));
}
