import { guarded, json, queryHousehold } from '../../../../lib/server/api/bearer-route';
import { publicPushConfig } from '../../../../lib/server/notifications/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/notifications/config -> { webPushPublicKey, pushEnabled }. Public values only (the VAPID PUBLIC key). */
export async function GET(req: Request) {
  return guarded(req, queryHousehold(req), {}, async () => json(publicPushConfig()));
}
