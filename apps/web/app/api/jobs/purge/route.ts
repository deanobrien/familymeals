import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '../../../../lib/server/auth/admin';
import { readPublicEnv } from '../../../../lib/supabase/env';
import { checkJobsSecret } from '../../../../lib/server/jobs/secret';
import { runPurgeJob } from '../../../../lib/server/jobs/purge-job';
import { supabaseDeleteAuthUser, supabasePurgeJobDb } from '../../../../lib/server/jobs/supabase-db';
import { localFileStoreAllowed } from '../../../../lib/server/config/production';
import { localUploadsRemover, supabaseBucketRemover } from '../../../../lib/server/objects/stores';
import type { ObjectRemovers } from '../../../../lib/server/objects/port';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * POST /api/jobs/purge (DX1, D256): scheduled deletion work. Public to middleware (no user session) but refuses
 * every request without the JOBS_SECRET header (`x-jobs-secret`); with JOBS_SECRET unset the endpoint is disabled
 * (503). Uses the service-role client: this job is the one sanctioned non-user path (D100), and it never takes ids
 * from the request. Idempotent; safe to call as often as every few minutes. Returns counts only.
 */
export async function POST(req: Request) {
  const auth = checkJobsSecret(req.headers);
  if (auth === 'unconfigured') return NextResponse.json({ error: 'jobs_disabled' }, { status: 503, headers: NO_STORE });
  if (auth !== 'ok') return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });

  if (!readPublicEnv() || process.env.DATA_BACKEND !== 'supabase' || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: true, skipped: 'no_supabase_backend' }, { status: 200, headers: NO_STORE });
  }
  const admin = createSupabaseAdminClient();
  const removers: ObjectRemovers = {
    'recipe-images': supabaseBucketRemover(admin, 'recipe-images'),
    'receipt-images': supabaseBucketRemover(admin, 'receipt-images'),
  };
  // The legacy local photo store only exists where it is allowed (dev, or a first test deploy with ALLOW_LOCAL_FILE_STORE).
  if (process.env.NODE_ENV !== 'production' || localFileStoreAllowed()) removers['local-uploads'] = localUploadsRemover();

  const started = Date.now();
  const result = await runPurgeJob({ db: supabasePurgeJobDb(admin), deleteAuthUser: supabaseDeleteAuthUser(admin), removers });
  return NextResponse.json({ ...result, durationMs: Date.now() - started }, { status: result.ok ? 200 : 500, headers: NO_STORE });
}

export function GET() {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405, headers: { ...NO_STORE, allow: 'POST' } });
}
