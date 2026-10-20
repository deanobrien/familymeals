import type { SupabaseClient } from '@supabase/supabase-js';
import { mapDbError } from '../auth/errors';
import type { Result } from '../auth/household-service';
import { isUuid } from '../auth/memberships';

/**
 * Deletion lifecycle data access for Settings > Your data (DX1). User-scoped client only (RLS + SECURITY DEFINER
 * RPCs that check auth.uid()); nothing here uses the service role. Errors are mapped to fixed codes (errors.ts).
 */
const ok = <T>(data: T): Result<T> => ({ ok: true, data });

export interface LifecycleView {
  /** households.purge_after while pending deletion */
  purgeAfter: string | null;
  /** pending account deletion time (my_account_deletion) */
  accountDeletionAt: string | null;
  activeMembers: number;
  otherOwners: number;
}

export async function loadLifecycle(client: SupabaseClient, householdId: string, userId: string): Promise<LifecycleView> {
  const [h, acct, members] = await Promise.all([
    client.from('households').select('purge_after').eq('id', householdId).maybeSingle(),
    client.rpc('my_account_deletion'),
    client.from('household_members').select('user_id, role').eq('household_id', householdId).eq('status', 'active'),
  ]);
  const rows = ((members.data ?? []) as { user_id: string; role: string }[]);
  return {
    purgeAfter: (h.data as { purge_after?: string | null } | null)?.purge_after ?? null,
    accountDeletionAt: typeof acct.data === 'string' ? acct.data : null,
    activeMembers: rows.length,
    otherOwners: rows.filter((r) => r.role === 'owner' && r.user_id !== userId).length,
  };
}

export async function requestHouseholdDeletion(client: SupabaseClient, householdId: string): Promise<Result<{ purgeAfter: string }>> {
  if (!isUuid(householdId)) return { ok: false, error: 'invalid_input' };
  const { data, error } = await client.rpc('request_household_deletion', { p_household_id: householdId });
  if (error) return { ok: false, error: mapDbError(error) };
  return typeof data === 'string' ? ok({ purgeAfter: data }) : { ok: false, error: 'unknown' };
}

export async function requestAccountDeletion(client: SupabaseClient): Promise<Result<{ scheduledAt: string }>> {
  const { data, error } = await client.rpc('request_account_deletion');
  if (error) return { ok: false, error: mapDbError(error) };
  return typeof data === 'string' ? ok({ scheduledAt: data }) : { ok: false, error: 'unknown' };
}

export async function cancelAccountDeletion(client: SupabaseClient): Promise<Result<boolean>> {
  const { data, error } = await client.rpc('cancel_account_deletion');
  if (error) return { ok: false, error: mapDbError(error) };
  return ok(data === true);
}
