import { apiError, bodyHousehold, guarded, isRecord, readJson } from '../../../../lib/server/api/bearer-route';
import { callerOf, respond } from '../../../../lib/server/notifications/http';
import { registerDevice, unregisterDevice } from '../../../../lib/server/notifications/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/notifications/devices
 *  { householdId?, action: 'register', platform: 'android', channel: 'expo', token }            (Android, Expo push token)
 *  { householdId?, action: 'register', platform: 'web', channel: 'webpush', token: endpoint, keys } (browser subscription)
 *  { action: 'unregister', token }
 * -> { devices: { web, android } }
 */
export async function POST(req: Request) {
  const body = await readJson(req);
  return guarded(req, bodyHousehold(body), {}, async (auth) => {
    if (!isRecord(body)) return apiError(400, 'BAD_REQUEST', 'Send { action } as JSON.');
    if (body.action === 'register') return respond(await registerDevice(callerOf(auth), body));
    if (body.action === 'unregister') return respond(await unregisterDevice(callerOf(auth), body.token));
    return apiError(400, 'BAD_REQUEST', 'Unknown action.');
  });
}
