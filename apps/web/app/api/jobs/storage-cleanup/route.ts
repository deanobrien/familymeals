import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '../../../../lib/server/auth/admin';
import { cronSecretMatches, runStorageCleanup, type CleanupDb } from '../../../../lib/server/images/cleanup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/jobs/storage-cleanup: the scheduled storage cleanup (ST1, D190). NOT a user route: it is protected by a shared
 * secret in the `x-cron-secret` header (App Service setting CRON_SECRET, 16+ chars) and runs with the service-role client
 * (SUPABASE_SERVICE_ROLE_KEY): it deletes expired / abandoned / orphaned Storage objects and nothing else.
 * Schedule it at least daily (docs/DEPLOY-APP-SERVICE.md: Logic App recurrence, or a WebJob).
 *  503 = not configured (no CRON_SECRET / service key): the job refuses to run open.   401 = wrong or missing secret.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16 || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'storage cleanup is not configured (CRON_SECRET / SUPABASE_SERVICE_ROLE_KEY)' }, { status: 503 });
  }
  if (!cronSecretMatches(req.headers.get('x-cron-secret'), secret)) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }
  try {
    const summary = await runStorageCleanup(createSupabaseAdminClient() as unknown as CleanupDb);
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    console.error('[storage-cleanup] failed', e instanceof Error ? e.message : 'unknown error');
    return NextResponse.json({ ok: false, error: 'storage cleanup failed; see the application log' }, { status: 500 });
  }
}
