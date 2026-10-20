/**
 * The scheduled purge job (DX1, D256/D257), behind POST /api/jobs/purge. Pure orchestration over injected ports so it
 * is unit-testable; the route wires the service-role Supabase client (the ONLY place the job uses it).
 *  1. jobs_purge_due: purge households past their 14-day grace + replay the deletion ledger (restored households)
 *  2. due account deletions: jobs_prepare_account_purge -> auth admin deleteUser -> jobs_complete_account_purge
 *  3. storage: ST1's queue-driven cleanup (runStorageCleanup, D190/D195) removes the objects step 1 queued
 *  4. jobs_status counts for monitoring
 * Idempotent: every step only acts on rows still pending, so re-running (or overlapping runs) does no harm.
 * The result carries counts only: never ids, paths, names or emails (it ends up in scheduler run history).
 */
export interface PurgeJobDb {
  purgeDue(limit: number): Promise<{ purged: number; replayed: number }>;
  dueAccounts(limit: number): Promise<{ userId: string; replay: boolean }[]>;
  prepareAccount(userId: string): Promise<'ready' | 'blocked_owner' | 'blocked_household' | string>;
  completeAccount(userId: string): Promise<void>;
  status(): Promise<Record<string, number>>;
}

export interface StorageCleanupResult {
  deleted: number;
  failed: number;
}

export interface PurgeJobDeps {
  db: PurgeJobDb;
  /** Deletes an auth user (service role). Resolves 'deleted' or 'not_found' (already gone); throws on failure. */
  deleteAuthUser(userId: string): Promise<'deleted' | 'not_found'>;
  /** Processes storage_cleanup_queue (ST1's runStorageCleanup). */
  storageCleanup(): Promise<StorageCleanupResult>;
  limits?: { households?: number; accounts?: number };
}

export interface PurgeJobResult {
  ok: boolean;
  households: { purged: number; replayed: number };
  accounts: { deleted: number; replayed: number; blocked: number; failed: number };
  storage: StorageCleanupResult;
  status: Record<string, number>;
  errors: string[];
}

export async function runPurgeJob(deps: PurgeJobDeps): Promise<PurgeJobResult> {
  const lim = { households: 25, accounts: 25, ...deps.limits };
  const out: PurgeJobResult = {
    ok: true,
    households: { purged: 0, replayed: 0 },
    accounts: { deleted: 0, replayed: 0, blocked: 0, failed: 0 },
    storage: { deleted: 0, failed: 0 },
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

  // 3. storage objects queued by the purges (and anything else pending)
  try {
    const s = await deps.storageCleanup();
    out.storage = { deleted: s.deleted, failed: s.failed };
    if (s.failed > 0) fail('storage');
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
