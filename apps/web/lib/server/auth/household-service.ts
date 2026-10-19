import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { CreateInvitationInput } from '@fr/domain';
import { mapDbError, type AuthErrorCode } from './errors';
import { isUuid, type HouseholdRole, type HouseholdStatus, type HouseholdSummary } from './memberships';

/**
 * Data access for households, members and invitations. Every function takes the (user-scoped) Supabase
 * client, so RLS is the authority; nothing here uses the service role. Functions never log, and never put
 * raw errors, tokens or emails into their results (see errors.ts).
 */
export type Result<T> = { ok: true; data: T } | { ok: false; error: AuthErrorCode };

const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const fail = (error: AuthErrorCode): Result<never> => ({ ok: false, error });

export const INVITE_TOKEN_RE = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// Form schemas
// ---------------------------------------------------------------------------
export const CreateHouseholdForm = z.object({
  name: z.string().trim().min(1).max(120),
  defaultServings: z.coerce.number().int().min(1).max(50).default(4),
  /** pounds as typed by the user (blank = no budget) */
  weeklyBudgetPounds: z
    .union([z.literal(''), z.coerce.number().min(0).max(100000)])
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v)),
  displayName: z.string().trim().max(80).optional().transform((v) => (v ? v : undefined)),
});
export type CreateHouseholdForm = z.infer<typeof CreateHouseholdForm>;

export const InviteForm = z.object({
  email: z
    .union([z.literal(''), z.email().max(254)])
    .optional()
    .transform((v) => (v ? v.toLowerCase() : undefined)),
  role: CreateInvitationInput.shape.role,
  ttlHours: z.coerce.number().int().min(1).max(720).default(168),
});

export const poundsToPence = (pounds: number | null): number | null =>
  pounds === null ? null : Math.round(pounds * 100);

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
interface MembershipRow {
  role: HouseholdRole;
  joined_at: string;
  households:
    | { id: string; name: string; status: HouseholdStatus; default_servings: number; weekly_budget_pence: number | null }
    | Array<{ id: string; name: string; status: HouseholdStatus; default_servings: number; weekly_budget_pence: number | null }>
    | null;
}

export async function loadMemberships(client: SupabaseClient, userId: string): Promise<Result<HouseholdSummary[]>> {
  const { data, error } = await client
    .from('household_members')
    .select('role, joined_at, households(id, name, status, default_servings, weekly_budget_pence)')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('joined_at', { ascending: true });
  if (error) return fail(mapDbError(error));
  const out: HouseholdSummary[] = [];
  for (const row of (data ?? []) as unknown as MembershipRow[]) {
    const h = Array.isArray(row.households) ? row.households[0] : row.households;
    if (!h) continue; // household not visible (should not happen for an active member)
    out.push({
      id: h.id,
      name: h.name,
      status: h.status,
      role: row.role,
      defaultServings: h.default_servings,
      weeklyBudgetPence: h.weekly_budget_pence,
      joinedAt: row.joined_at,
    });
  }
  return ok(out);
}

export interface MemberSummary {
  id: string;
  userId: string;
  role: HouseholdRole;
  displayName: string;
  joinedAt: string;
  isYou: boolean;
}

export async function listMembers(client: SupabaseClient, householdId: string, myUserId: string): Promise<Result<MemberSummary[]>> {
  const { data, error } = await client
    .from('household_members')
    .select('id, user_id, role, display_name, joined_at')
    .eq('household_id', householdId)
    .eq('status', 'active')
    .order('joined_at', { ascending: true });
  if (error) return fail(mapDbError(error));
  const rows = (data ?? []) as Array<{ id: string; user_id: string; role: HouseholdRole; display_name: string | null; joined_at: string }>;
  return ok(
    rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      role: r.role,
      displayName: r.display_name?.trim() || 'Household member',
      joinedAt: r.joined_at,
      isYou: r.user_id === myUserId,
    })),
  );
}

export interface PendingInvitation {
  id: string;
  email: string | null;
  role: HouseholdRole;
  expiresAt: string;
  createdAt: string;
  expired: boolean;
}

/** Owner-only (RLS): non-owners get an empty list. Never returns token material (only the hash exists). */
export async function listPendingInvitations(
  client: SupabaseClient,
  householdId: string,
  now: Date = new Date(),
): Promise<Result<PendingInvitation[]>> {
  const { data, error } = await client
    .from('invitations')
    .select('id, email, role, expires_at, created_at')
    .eq('household_id', householdId)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });
  if (error) return fail(mapDbError(error));
  const rows = (data ?? []) as Array<{ id: string; email: string | null; role: HouseholdRole; expires_at: string; created_at: string }>;
  return ok(
    rows.map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role,
      expiresAt: r.expires_at,
      createdAt: r.created_at,
      expired: new Date(r.expires_at).getTime() <= now.getTime(),
    })),
  );
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------
export async function createHousehold(
  client: SupabaseClient,
  userId: string,
  input: CreateHouseholdForm,
): Promise<Result<{ id: string }>> {
  const { data, error } = await client
    .from('households')
    .insert({
      name: input.name,
      default_servings: input.defaultServings,
      weekly_budget_pence: poundsToPence(input.weeklyBudgetPounds ?? null),
    })
    .select('id')
    .single();
  if (error || !data) return fail(error ? mapDbError(error) : 'unknown');
  const id = (data as { id: string }).id;
  if (input.displayName) {
    // Best effort: the owner row was created by the bootstrap trigger.
    await client.from('household_members').update({ display_name: input.displayName }).eq('household_id', id).eq('user_id', userId);
  }
  return ok({ id });
}

export interface CreatedInvitation {
  invitationId: string;
  /** Raw token: returned once by the database; show it to the owner, never store or log it. */
  token: string;
  expiresAt: string;
}

export async function createInvitation(
  client: SupabaseClient,
  input: { householdId: string; email?: string; role: HouseholdRole; ttlHours: number },
): Promise<Result<CreatedInvitation>> {
  if (!isUuid(input.householdId)) return fail('invalid_input');
  const { data, error } = await client.rpc('create_invitation', {
    p_household_id: input.householdId,
    p_email: input.email ?? null,
    p_role: input.role,
    p_ttl: `${input.ttlHours} hours`,
  });
  if (error) return fail(mapDbError(error));
  const row = (Array.isArray(data) ? data[0] : data) as { invitation_id?: string; token?: string; expires_at?: string } | undefined;
  if (!row?.invitation_id || !row.token || !INVITE_TOKEN_RE.test(row.token) || !row.expires_at) return fail('unknown');
  return ok({ invitationId: row.invitation_id, token: row.token, expiresAt: row.expires_at });
}

export async function revokeInvitation(client: SupabaseClient, householdId: string, invitationId: string): Promise<Result<true>> {
  if (!isUuid(householdId) || !isUuid(invitationId)) return fail('invalid_input');
  const { data, error } = await client
    .from('invitations')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', invitationId)
    .eq('household_id', householdId)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .select('id');
  if (error) return fail(mapDbError(error));
  return (data ?? []).length > 0 ? ok(true) : fail('not_found');
}

/** Owner removes another active member. Owners must be demoted first (keeps the last-owner guard simple). */
export async function revokeMember(
  client: SupabaseClient,
  householdId: string,
  memberId: string,
  myUserId: string,
): Promise<Result<true>> {
  if (!isUuid(householdId) || !isUuid(memberId)) return fail('invalid_input');
  const { data, error } = await client
    .from('household_members')
    .update({ status: 'revoked' })
    .eq('id', memberId)
    .eq('household_id', householdId)
    .eq('status', 'active')
    .eq('role', 'member')
    .neq('user_id', myUserId)
    .select('id');
  if (error) return fail(mapDbError(error));
  return (data ?? []).length > 0 ? ok(true) : fail('not_found');
}

/**
 * Promote the target to owner, then demote the caller to member. Two statements (no RPC exists): promoting
 * first guarantees the household never has zero owners, so a failure in step 2 leaves two owners, not none.
 */
export async function transferOwnership(
  client: SupabaseClient,
  householdId: string,
  targetMemberId: string,
  myUserId: string,
): Promise<Result<true>> {
  if (!isUuid(householdId) || !isUuid(targetMemberId)) return fail('invalid_input');
  const promote = await client
    .from('household_members')
    .update({ role: 'owner' })
    .eq('id', targetMemberId)
    .eq('household_id', householdId)
    .eq('status', 'active')
    .neq('user_id', myUserId)
    .select('id');
  if (promote.error) return fail(mapDbError(promote.error));
  if ((promote.data ?? []).length === 0) return fail('not_found');
  const demote = await client
    .from('household_members')
    .update({ role: 'member' })
    .eq('household_id', householdId)
    .eq('user_id', myUserId)
    .eq('status', 'active')
    .select('id');
  if (demote.error) return fail(mapDbError(demote.error));
  return ok(true);
}

export async function leaveHousehold(client: SupabaseClient, householdId: string): Promise<Result<true>> {
  if (!isUuid(householdId)) return fail('invalid_input');
  const { error } = await client.rpc('member_leave', { p_household_id: householdId });
  return error ? fail(mapDbError(error)) : ok(true);
}

export async function cancelHouseholdDeletion(client: SupabaseClient, householdId: string): Promise<Result<true>> {
  if (!isUuid(householdId)) return fail('invalid_input');
  const { error } = await client.rpc('cancel_household_deletion', { p_household_id: householdId });
  return error ? fail(mapDbError(error)) : ok(true);
}

export async function acceptInvitation(client: SupabaseClient, token: string): Promise<Result<{ householdId: string }>> {
  if (!INVITE_TOKEN_RE.test(token)) return fail('invitation_invalid');
  const { data, error } = await client.rpc('accept_invitation', { p_token: token });
  if (error) {
    const code = mapDbError(error);
    // Any rejection of a token (wrong, expired, used, revoked) is reported identically.
    return fail(code === 'unknown' || code === 'invalid_input' ? 'invitation_invalid' : code);
  }
  if (typeof data !== 'string' || !isUuid(data)) return fail('unknown');
  return ok({ householdId: data });
}
