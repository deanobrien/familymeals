'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveAuthMode } from '../../lib/supabase/env';
import { createSupabaseServerClient } from '../../lib/supabase/server';
import type { AuthErrorCode } from '../../lib/server/auth/errors';
import {
  CreateHouseholdForm,
  InviteForm,
  cancelHouseholdDeletion,
  createHousehold,
  createInvitation,
  leaveHousehold,
  loadMemberships,
  revokeInvitation,
  revokeMember,
  transferOwnership,
  type Result,
} from '../../lib/server/auth/household-service';
import { requireHouseholdContext, requireSessionUser } from '../../lib/server/auth/household-context';
import { ACTIVE_HOUSEHOLD_COOKIE, isUuid } from '../../lib/server/auth/memberships';
import { buildInviteUrl, getSiteUrl } from '../../lib/server/auth/site-url';

/**
 * Household server actions. The household id ALWAYS comes from the server-resolved active household
 * (never from the form), so a forged id cannot target another household (threat R2); RLS is the backstop.
 */
const field = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === 'string' ? v : '';
};

function done(error?: AuthErrorCode, notice?: string): never {
  const q = new URLSearchParams();
  if (error) q.set('error', error);
  if (notice) q.set('notice', notice);
  const s = q.toString();
  redirect(s ? `/household?${s}` : '/household');
}

async function setActiveCookie(id: string) {
  (await cookies()).set(ACTIVE_HOUSEHOLD_COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
}

function guardMock() {
  if (resolveAuthMode() !== 'supabase') done('mock_mode');
}

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) done(r.error);
  return r.data;
}

export async function createHouseholdAction(fd: FormData): Promise<void> {
  if (resolveAuthMode() !== 'supabase') redirect('/household/new?error=mock_mode');
  const user = await requireSessionUser();
  const parsed = CreateHouseholdForm.safeParse({
    name: field(fd, 'name'),
    defaultServings: field(fd, 'defaultServings') || 4,
    weeklyBudgetPounds: field(fd, 'weeklyBudgetPounds'),
    displayName: field(fd, 'displayName'),
  });
  if (!parsed.success) redirect('/household/new?error=invalid_input');
  const supabase = await createSupabaseServerClient();
  const res = await createHousehold(supabase, user.id, parsed.data);
  if (!res.ok) redirect(`/household/new?error=${res.error}`);
  await setActiveCookie(res.data.id);
  redirect('/household');
}

export async function switchHouseholdAction(fd: FormData): Promise<void> {
  guardMock();
  const user = await requireSessionUser();
  const id = field(fd, 'householdId');
  if (!isUuid(id)) done('invalid_input');
  const supabase = await createSupabaseServerClient();
  const memberships = unwrap(await loadMemberships(supabase, user.id));
  if (!memberships.some((m) => m.id === id)) done('forbidden');
  await setActiveCookie(id);
  done();
}

export interface InviteState {
  error?: AuthErrorCode;
  /** Shown once to the owner. Not persisted anywhere. */
  link?: string;
  expiresAt?: string;
}

/** useActionState-compatible: the token only travels in this action's response, never in a URL. */
export async function inviteAction(_prev: InviteState, fd: FormData): Promise<InviteState> {
  if (resolveAuthMode() !== 'supabase') return { error: 'mock_mode' };
  const ctx = await requireHouseholdContext();
  if (!ctx.isOwner) return { error: 'forbidden' };
  if (ctx.readOnly) return { error: 'read_only' };
  const parsed = InviteForm.safeParse({ email: field(fd, 'email'), role: field(fd, 'role') || 'member', ttlHours: field(fd, 'ttlHours') || 168 });
  if (!parsed.success) return { error: 'invalid_input' };
  const res = await createInvitation(ctx.supabase, { householdId: ctx.household.id, ...parsed.data });
  if (!res.ok) return { error: res.error };
  // TODO(email): send the invite email here (hook). Until then the owner copies the link.
  return { link: buildInviteUrl(await getSiteUrl(), res.data.token), expiresAt: res.data.expiresAt };
}

export async function revokeInvitationAction(fd: FormData): Promise<void> {
  guardMock();
  const ctx = await requireHouseholdContext();
  if (!ctx.isOwner) done('forbidden');
  unwrap(await revokeInvitation(ctx.supabase, ctx.household.id, field(fd, 'invitationId')));
  done(undefined, 'invitation_revoked');
}

export async function revokeMemberAction(fd: FormData): Promise<void> {
  guardMock();
  const ctx = await requireHouseholdContext();
  if (!ctx.isOwner) done('forbidden');
  unwrap(await revokeMember(ctx.supabase, ctx.household.id, field(fd, 'memberId'), ctx.user.id));
  done(undefined, 'member_removed');
}

export async function transferOwnershipAction(fd: FormData): Promise<void> {
  guardMock();
  const ctx = await requireHouseholdContext();
  if (!ctx.isOwner) done('forbidden');
  unwrap(await transferOwnership(ctx.supabase, ctx.household.id, field(fd, 'memberId'), ctx.user.id));
  done(undefined, 'ownership_transferred');
}

export async function leaveHouseholdAction(): Promise<void> {
  guardMock();
  const ctx = await requireHouseholdContext();
  unwrap(await leaveHousehold(ctx.supabase, ctx.household.id));
  (await cookies()).delete(ACTIVE_HOUSEHOLD_COOKIE);
  redirect('/household');
}

export async function cancelDeletionAction(): Promise<void> {
  guardMock();
  const ctx = await requireHouseholdContext();
  if (!ctx.isOwner) done('forbidden');
  unwrap(await cancelHouseholdDeletion(ctx.supabase, ctx.household.id));
  done(undefined, 'deletion_cancelled');
}
