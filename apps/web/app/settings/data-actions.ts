'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { AuthErrorCode } from '../../lib/server/auth/errors';
import { cancelHouseholdDeletion } from '../../lib/server/auth/household-service';
import { requireHouseholdContext } from '../../lib/server/auth/household-context';
import { ACTIVE_HOUSEHOLD_COOKIE } from '../../lib/server/auth/memberships';
import { verifyCurrentPassword } from '../../lib/server/auth/reauth';
import { cancelAccountDeletion, requestAccountDeletion, requestHouseholdDeletion } from '../../lib/server/privacy/lifecycle';
import { resolveAuthMode } from '../../lib/supabase/env';

/**
 * Settings > Your data: destructive lifecycle actions (DX1). The household id always comes from the server-resolved
 * active household, never the form. Requesting a deletion needs the typed confirmation AND the current password
 * (re-authentication, D258). Cancelling needs neither (it only restores).
 */
export interface DataActionState {
  error?: AuthErrorCode | 'confirm_mismatch' | 'reauth_failed';
}

const field = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === 'string' ? v : '';
};

const done = (notice: string): never => redirect(`/settings?notice=${notice}#your-data`);

export async function requestHouseholdDeletionAction(_prev: DataActionState, fd: FormData): Promise<DataActionState> {
  if (resolveAuthMode() !== 'supabase') return { error: 'mock_mode' };
  const ctx = await requireHouseholdContext();
  if (!ctx.isOwner) return { error: 'forbidden' };
  if (ctx.readOnly) return { error: 'read_only' };
  if (field(fd, 'confirmName').trim() !== ctx.household.name.trim()) return { error: 'confirm_mismatch' };
  if (!(await verifyCurrentPassword(ctx.user.email, field(fd, 'password')))) return { error: 'reauth_failed' };
  const res = await requestHouseholdDeletion(ctx.supabase, ctx.household.id);
  if (!res.ok) return { error: res.error };
  // TODO(email): notify every member (needs the transactional email hook; tracked in DATA-EXPORT-DELETION.md).
  done('household_deletion_scheduled');
  return {};
}

export async function cancelHouseholdDeletionAction(): Promise<void> {
  if (resolveAuthMode() !== 'supabase') done('mock_mode');
  const ctx = await requireHouseholdContext();
  if (!ctx.isOwner) done('forbidden');
  const res = await cancelHouseholdDeletion(ctx.supabase, ctx.household.id);
  done(res.ok ? 'household_deletion_cancelled' : res.error);
}

export async function requestAccountDeletionAction(_prev: DataActionState, fd: FormData): Promise<DataActionState> {
  if (resolveAuthMode() !== 'supabase') return { error: 'mock_mode' };
  const ctx = await requireHouseholdContext();
  if (field(fd, 'confirmText').trim().toUpperCase() !== 'DELETE') return { error: 'confirm_mismatch' };
  if (!(await verifyCurrentPassword(ctx.user.email, field(fd, 'password')))) return { error: 'reauth_failed' };
  const res = await requestAccountDeletion(ctx.supabase);
  if (!res.ok) return { error: res.error };
  if (new Date(res.data.scheduledAt).getTime() <= Date.now() + 60_000) {
    // Nothing left to wait for (no sole-member household): sign out; the next job run deletes the account.
    await ctx.supabase.auth.signOut().catch(() => undefined);
    (await cookies()).delete(ACTIVE_HOUSEHOLD_COOKIE);
    redirect('/sign-in?deleted=1');
  }
  done('account_deletion_scheduled');
  return {};
}

export async function cancelAccountDeletionAction(): Promise<void> {
  if (resolveAuthMode() !== 'supabase') done('mock_mode');
  const ctx = await requireHouseholdContext();
  const res = await cancelAccountDeletion(ctx.supabase);
  done(res.ok ? 'account_deletion_cancelled' : res.error);
}
