// Who is calling the sharing service: the web session (cookies) or the Android app (Bearer token). P3-A, D420.
import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { readPublicEnv, resolveAuthMode } from '../../supabase/env';
import { getAuthState, requireHouseholdContext } from '../auth/household-context';
import type { RequestAuth } from '../auth/request-auth';
import { resolveRequestAuth } from '../auth/request-auth';
import { MOCK_USER_NAME } from '../auth/mock';
import { useSupabaseBackend } from '../supabase/backend';
import type { ShareCaller, ShareViewerCtx } from './service';

/** A bearer / cookie caller as a share caller. In memory mode the demo user's name stands in for the display name. */
export const shareCallerOf = (auth: RequestAuth): ShareCaller => ({
  householdId: auth.householdId, userId: auth.userId, displayName: auth.dataContext ? null : MOCK_USER_NAME,
  client: auth.dataContext?.client ?? null, readOnly: auth.readOnly,
});

/** The signed-in web user (cookie session) as a share caller; redirects to sign-in when signed out. */
export async function webShareCaller(): Promise<ShareCaller> {
  const ctx = await requireHouseholdContext();
  return {
    householdId: ctx.household.id, userId: ctx.user.id, displayName: ctx.mode === 'mock' ? MOCK_USER_NAME : null,
    client: ctx.mode === 'supabase' ? ctx.supabase : null, readOnly: ctx.readOnly,
  };
}

/** A signed-out visitor's client in Supabase mode (the anon role: it can only call read_recipe_share). null in memory mode. */
function anonClient() {
  if (!useSupabaseBackend() || resolveAuthMode() !== 'supabase') return null;
  const env = readPublicEnv();
  return env ? createClient(env.url, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}

/** The viewer of a link page on the web: the session user (with their active household), or signed out. */
export async function webShareViewer(): Promise<ShareViewerCtx> {
  const state = await getAuthState();
  if (!state) return { userId: null, householdId: null, client: anonClient() };
  const client = state.mode === 'supabase' && useSupabaseBackend() ? state.supabase : null;
  return { userId: state.user.id, householdId: state.activeId, client };
}

/**
 * The viewer of a link in a JSON route. A valid bearer token (or web session) means signed in; no credentials at all means a
 * signed-out visitor. A token that is sent but not accepted is refused rather than quietly downgraded.
 */
export async function routeShareViewer(req: Request, householdId: string | undefined): Promise<{ ok: true; viewer: ShareViewerCtx; auth: RequestAuth | null } | { ok: false; status: 400 | 401 | 403; message: string }> {
  const who = await resolveRequestAuth(req, householdId);
  if (who.ok) return { ok: true, auth: who.auth, viewer: { userId: who.auth.userId, householdId: who.auth.householdId, client: who.auth.dataContext?.client ?? null } };
  if (who.status === 401 && !/^Bearer\s+\S+$/i.test(req.headers.get('authorization')?.trim() ?? '')) {
    return { ok: true, auth: null, viewer: { userId: null, householdId: null, client: anonClient() } };
  }
  return who;
}
