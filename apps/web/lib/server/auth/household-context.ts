import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { resolveAuthMode } from '../../supabase/env';
import { createSupabaseServerClient } from '../../supabase/server';
import { loadMemberships } from './household-service';
import {
  ACTIVE_HOUSEHOLD_COOKIE,
  isReadOnly,
  pickActiveMembership,
  type HouseholdRole,
  type HouseholdSummary,
} from './memberships';
import { createUnavailableClient, getMockIdentity } from './mock';
import { SIGN_IN_PATH } from './routes';

export interface SessionUser {
  id: string;
  email: string | null;
}

export interface HouseholdContext {
  user: SessionUser;
  /** Active household (cookie-selected among the user's memberships; falls back to the oldest). */
  household: HouseholdSummary;
  role: HouseholdRole;
  isOwner: boolean;
  /** true while the household is pending deletion: writes are refused by the database (owner decision D). */
  readOnly: boolean;
  /** All active memberships, for the switcher. */
  memberships: HouseholdSummary[];
  /** User-scoped client (RLS applies). In mock mode a client that throws on use. */
  supabase: SupabaseClient;
  mode: 'supabase' | 'mock';
}

export interface AuthState {
  user: SessionUser;
  memberships: HouseholdSummary[];
  supabase: SupabaseClient;
  mode: 'supabase' | 'mock';
  activeId: string | null;
}

/** Verified user (validated by the auth server) or null. Per-request cached. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const mode = resolveAuthMode();
  if (mode === 'mock') return getMockIdentity().user;
  if (mode === 'unconfigured') return null;
  const supabase = await createSupabaseServerClient();
  try {
    const { data } = await supabase.auth.getUser();
    return data.user ? { id: data.user.id, email: data.user.email ?? null } : null;
  } catch {
    return null;
  }
});

/** User + memberships (possibly empty, e.g. mid-onboarding). null when signed out. */
export const getAuthState = cache(async (): Promise<AuthState | null> => {
  const mode = resolveAuthMode();
  const user = await getSessionUser();
  if (!user || mode === 'unconfigured') return null;
  const store = await cookies();
  const cookieId = store.get(ACTIVE_HOUSEHOLD_COOKIE)?.value;
  if (mode === 'mock') {
    const { household } = getMockIdentity(process.env.NODE_ENV, cookieId);
    return { user, memberships: [household], supabase: createUnavailableClient(), mode: 'mock', activeId: household.id };
  }
  const supabase = await createSupabaseServerClient();
  const res = await loadMemberships(supabase, user.id);
  const memberships = res.ok ? res.data : [];
  return { user, memberships, supabase, mode: 'supabase', activeId: pickActiveMembership(memberships, cookieId)?.id ?? null };
});

/**
 * Current user + active household + role, or null if signed out or the user has no household yet.
 * Use requireHouseholdContext() in pages/actions that need one.
 */
export const getHouseholdContext = cache(async (): Promise<HouseholdContext | null> => {
  const state = await getAuthState();
  if (!state) return null;
  const household = state.memberships.find((m) => m.id === state.activeId);
  if (!household) return null;
  return {
    user: state.user,
    household,
    role: household.role,
    isOwner: household.role === 'owner',
    readOnly: isReadOnly(household),
    memberships: state.memberships,
    supabase: state.supabase,
    mode: state.mode,
  };
});

/** Redirects to sign-in when signed out, or to onboarding (/household/new) when the user has no household. */
export async function requireHouseholdContext(): Promise<HouseholdContext> {
  const ctx = await getHouseholdContext();
  if (ctx) return ctx;
  const user = await getSessionUser();
  redirect(user ? '/household/new' : SIGN_IN_PATH);
}

/** Redirects to sign-in when signed out. */
export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(SIGN_IN_PATH);
  return user;
}

/** Throws unless the context is writable (not pending deletion). For server actions. */
export function assertWritable(ctx: Pick<HouseholdContext, 'readOnly'>): void {
  if (ctx.readOnly) throw new Error('household is read-only');
}
