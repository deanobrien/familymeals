import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '../../../../lib/server/auth/admin';
import { readPublicEnv } from '../../../../lib/supabase/env';
import { checkJobsSecret } from '../../../../lib/server/jobs/secret';
import { configuredReceipts, configuredSenders } from '../../../../lib/server/notifications/config';
import { runNotifyJob } from '../../../../lib/server/notifications/job';
import { supabaseNotifyJobDb } from '../../../../lib/server/notifications/supabase-job-db';
import { getRestockService } from '../../../../lib/server/restock/deps';
import { runWithDataContext } from '../../../../lib/server/supabase/request-data-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'no-store' };

/** Below-minimum counts (PR1) for the opted-in households, computed household by household; a failing one counts 0. */
function restockCounts(admin: SupabaseClient) {
  return async (householdIds: readonly string[]): Promise<Map<string, number>> => {
    const out = new Map<string, number>();
    for (const hh of householdIds.slice(0, 200)) {
      try {
        const banner = await runWithDataContext({ client: admin, householdId: hh, userId: null }, () =>
          getRestockService(hh).getBanner(hh));
        // Auto-add puts them on the list already: no nudge needed.
        out.set(hh, banner.autoAdd ? 0 : banner.items.length);
      } catch {
        out.set(hh, 0);
      }
    }
    return out;
  };
}

/**
 * POST /api/jobs/notify (P1-C, D388): expiry alerts, restock nudges, activity-derived alerts, push delivery (Expo + Web
 * Push), Expo receipt check, dead-token pruning and retention. Same protection as /api/jobs/purge: JOBS_SECRET in
 * `x-jobs-secret` (unset = 503), never takes ids from the request, service role only here (D100). Idempotent (dedupe keys
 * + per-row push status), so the scheduler may call it as often as it likes; hourly is enough (expiry alerts go out in the
 * first run after each member's morning hour). Counts only in the response.
 */
export async function POST(req: Request) {
  const auth = checkJobsSecret(req.headers);
  if (auth === 'unconfigured') return NextResponse.json({ error: 'jobs_disabled' }, { status: 503, headers: NO_STORE });
  if (auth !== 'ok') return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });

  if (!readPublicEnv() || process.env.DATA_BACKEND !== 'supabase' || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: true, skipped: 'no_supabase_backend' }, { status: 200, headers: NO_STORE });
  }
  const admin = createSupabaseAdminClient();
  const started = Date.now();
  const receipts = configuredReceipts();
  const result = await runNotifyJob({
    db: supabaseNotifyJobDb(admin),
    senders: configuredSenders(),
    ...(receipts ? { receipts } : {}),
    restockCounts: restockCounts(admin),
  });
  return NextResponse.json({ ...result, durationMs: Date.now() - started }, { status: result.ok ? 200 : 500, headers: NO_STORE });
}

export function GET() {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405, headers: { ...NO_STORE, allow: 'POST' } });
}
