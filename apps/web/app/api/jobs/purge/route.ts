import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '../../../../lib/server/auth/admin';
import { readPublicEnv } from '../../../../lib/supabase/env';
import { runStorageCleanup, type CleanupDb } from '../../../../lib/server/images/cleanup';
import { checkJobsSecret } from '../../../../lib/server/jobs/secret';
import { runPurgeJob } from '../../../../lib/server/jobs/purge-job';
import { supabaseDeleteAuthUser, supabasePurgeJobDb } from '../../../../lib/server/jobs/supabase-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * POST /api/jobs/purge (DX1, D256): scheduled deletion work. Public to middleware (no user session) but refuses
 * every request without the JOBS_SECRET header (`x-jobs-secret`); with JOBS_SECRET unset the endpoint is disabled
 * (503). Uses the service-role client: this job is the one sanctioned non-user path (D100), and it never takes ids
 * from the request. Storage objects are removed by ST1's queue-driven cleanup (the same code as
 * /api/jobs/storage-cleanup), so scheduling this endpoint alone is enough. Idempotent; returns counts only.
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
  const result = await runPurgeJob({
    db: supabasePurgeJobDb(admin),
    deleteAuthUser: supabaseDeleteAuthUser(admin),
    storageCleanup: async () => {
      const s = await runStorageCleanup(admin as unknown as CleanupDb);
      return { deleted: s.deleted, failed: s.failed };
    },
  });
  // Phone-scanner sessions (P3-C, D449): useless an hour after they expire; photos pushed by a phone go with them.
  const scanner = (await admin.rpc('scanner_purge_expired')) as { data: number | null; error: unknown };
  if (scanner.error) console.error('[purge] scanner_purge_expired failed');
  return NextResponse.json({ ...result, scannerSessionsPurged: typeof scanner.data === 'number' ? scanner.data : 0, durationMs: Date.now() - started }, { status: result.ok ? 200 : 500, headers: NO_STORE });
}

export function GET() {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405, headers: { ...NO_STORE, allow: 'POST' } });
}
