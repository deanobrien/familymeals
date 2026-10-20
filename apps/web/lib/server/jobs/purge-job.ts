import { LOCAL_UPLOADS_BUCKET, type CleanupBucket, type ObjectRemovers } from '../objects/port';

/**
 * The scheduled purge job (DX1, D256/D257), behind POST /api/jobs/purge. Pure orchestration over injected ports so it
 * is unit-testable; the route wires the service-role Supabase client (the ONLY place the job uses it).
 *  1. jobs_purge_due: purge households past their 14-day grace + replay the deletion ledger (restored households)
 *  2. due account deletions: jobs_prepare_account_purge -> auth admin deleteUser -> jobs_complete_account_purge
 *  3. storage_cleanup_queue: claim a batch, delete objects per bucket, complete/fail each row
 *  4. jobs_status counts for monitoring
 * Idempotent: every step only acts on rows still pending, so re-running (or overlapping runs) does no harm.
 * The result carries counts only: never ids, paths, names or emails (it ends up in scheduler run history).
 */
export interface PurgeJobDb {
  purgeDue(limit: number): Promise<{ purged: number; replayed: number }>;
  dueAccounts(limit: number): Promise<{ userId: string; replay: boolean }[]>;
  prepareAccount(userId: string): Promise<'ready' | 'blocked_owner' | 'blocked_household' | string>;
  completeAccount(userId: string): Promise<void>;
  claimCleanup(limit: number): Promise<{ id: string; bucket: string; objectPath: string }[]>;
  completeCleanup(ids: string[]): Promise<void>;
  failCleanup(id: string, error: string): Promise<void>;
  status(): Promise<Record<string, number>>;
}

export interface PurgeJobDeps {
  db: PurgeJobDb;
  /** Deletes an auth user (service role). Resolves 'deleted' or 'not_found' (already gone); throws on failure. */
  deleteAuthUser(userId: string): Promise<'deleted' | 'not_found'>;
  removers: ObjectRemovers;
  limits?: { households?: number; accounts?: number; cleanup?: number };
}

export interface PurgeJobResult {
  ok: boolean;
  households: { purged: number; replayed: number };
  accounts: { deleted: number; replayed: number; blocked: number; failed: number };
  storage: { removed: number; failed: number; skipped: number };
  status: Record<string, number>;
  errors: string[];
}

export async function runPurgeJob(deps: PurgeJobDeps): Promise<PurgeJobResult> {
  const lim = { households: 25, accounts: 25, cleanup: 500, ...deps.limits };
  const out: PurgeJobResult = {
    ok: true,
    households: { purged: 0, replayed: 0 },
    accounts: { deleted: 0, replayed: 0, blocked: 0, failed: 0 },
    storage: { removed: 0, failed: 0, skipped: 0 },
    status: {},
    errors: [],
  };
  const fail = (step: string) => {
    out.ok = false;
    if (!out.errors.includes(step)) out.errors.push(step);
  };

  // 1. households (must run before accounts: a sole-member household is purged before its owner's auth user)
  try {
    out.households = await deps.db.purgeDue(lim.households);
  } catch {
    fail('households');
  }

  // 2. accounts
  try {
    for (const a of await deps.db.dueAccounts(lim.accounts)) {
      try {
        const prep = await deps.db.prepareAccount(a.userId);
        if (prep !== 'ready') {
          out.accounts.blocked += 1;
          continue;
        }
        await deps.deleteAuthUser(a.userId);
        await deps.db.completeAccount(a.userId);
        if (a.replay) out.accounts.replayed += 1;
        else out.accounts.deleted += 1;
      } catch {
        out.accounts.failed += 1;
        fail('accounts');
      }
    }
  } catch {
    fail('accounts');
  }

  // 3. storage cleanup
  try {
    const rows = await deps.db.claimCleanup(lim.cleanup);
    const byBucket = new Map<string, { id: string; path: string }[]>();
    for (const r of rows) (byBucket.get(r.bucket) ?? byBucket.set(r.bucket, []).get(r.bucket)!).push({ id: r.id, path: r.objectPath });
    for (const [bucket, items] of byBucket) {
      const remover = deps.removers[bucket as CleanupBucket];
      if (!remover) {
        // e.g. local-uploads when this instance has no local store: leave for an instance that has one
        out.storage.skipped += items.length;
        for (const it of items) await deps.db.failCleanup(it.id, `no remover for ${bucket === LOCAL_UPLOADS_BUCKET ? 'local uploads' : 'bucket'}`);
        continue;
      }
      const res = await remover.remove(items.map((i) => i.path));
      const removed = new Set(res.removed);
      const done = items.filter((i) => removed.has(i.path)).map((i) => i.id);
      if (done.length) await deps.db.completeCleanup(done);
      out.storage.removed += done.length;
      for (const f of res.failed) {
        const item = items.find((i) => i.path === f.path);
        if (item) await deps.db.failCleanup(item.id, f.error);
        out.storage.failed += 1;
      }
    }
    if (out.storage.failed > 0) fail('storage');
  } catch {
    fail('storage');
  }

  try {
    out.status = await deps.db.status();
  } catch {
    fail('status');
  }
  return out;
}
