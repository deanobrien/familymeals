import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PurgeJobDb } from './purge-job';

/** PurgeJobDb over the service-role client: the jobs_* RPCs of migration 20261020002500 (service role only). */
export function supabasePurgeJobDb(admin: SupabaseClient): PurgeJobDb {
  async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await admin.rpc(fn, args);
    if (error) throw new Error(`${fn} failed`);
    return data as T;
  }
  return {
    async purgeDue(limit) {
      const r = await call<{ purged?: number; replayed?: number }>('jobs_purge_due', { p_limit: limit });
      return { purged: Number(r?.purged ?? 0), replayed: Number(r?.replayed ?? 0) };
    },
    async dueAccounts(limit) {
      const rows = await call<{ user_id: string; replay: boolean }[]>('jobs_due_account_deletions', { p_limit: limit });
      return (rows ?? []).map((r) => ({ userId: r.user_id, replay: r.replay }));
    },
    prepareAccount: (userId) => call<string>('jobs_prepare_account_purge', { p_user_id: userId }),
    async completeAccount(userId) {
      await call('jobs_complete_account_purge', { p_user_id: userId });
    },
    async claimCleanup(limit) {
      const rows = await call<{ id: string; bucket: string; object_path: string }[]>('jobs_claim_storage_cleanup', { p_limit: limit });
      return (rows ?? []).map((r) => ({ id: r.id, bucket: r.bucket, objectPath: r.object_path }));
    },
    async completeCleanup(ids) {
      await call('jobs_complete_storage_cleanup', { p_ids: ids });
    },
    async failCleanup(id, error) {
      await call('jobs_fail_storage_cleanup', { p_id: id, p_error: error });
    },
    async status() {
      const r = await call<Record<string, unknown>>('jobs_status', {});
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(r ?? {})) out[k] = Number(v ?? 0);
      return out;
    },
  };
}

/** auth.admin.deleteUser; a user that is already gone counts as deleted (idempotent replays). */
export function supabaseDeleteAuthUser(admin: SupabaseClient) {
  return async (userId: string): Promise<'deleted' | 'not_found'> => {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (!error) return 'deleted';
    if (error.status === 404 || /not.?found/i.test(error.message)) return 'not_found';
    throw new Error('deleteUser failed');
  };
}
