// Who is calling a route handler: a web session (cookies) or the Android app (`Authorization: Bearer <supabase access
// token>`), D102. Bearer tokens are verified with the auth server (`auth.getUser(token)`) and the caller must be an
// ACTIVE member of the household they name; nothing is trusted from the request body beyond that household id.
import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readPublicEnv, resolveAuthMode } from '../../supabase/env';
import type { DataContext } from '../supabase/backend';
import { getHouseholdContext } from './household-context';
import { loadMemberships } from './household-service';
import { MOCK_SANDBOX_PATTERN } from './mock';
import { isReadOnly, isUuid, type HouseholdSummary } from './memberships';

export interface RequestAuth {
  userId: string;
  householdId: string;
  /** The household is pending deletion: writes are refused (owner decision D). */
  readOnly: boolean;
  /** The caller's own client + household for the Supabase repositories; null in mock-auth demo mode. */
  dataContext: DataContext | null;
}

export type AuthOutcome = { ok: true; auth: RequestAuth } | { ok: false; status: 400 | 401 | 403; message: string };

export interface BearerDeps {
  /** A client acting as the token's user (RLS applies). */
  clientFor(token: string): SupabaseClient;
}

const fail = (status: 400 | 401 | 403, message: string): AuthOutcome => ({ ok: false, status, message });

/** `Bearer <token>` -> token, else null. */
export function bearerToken(header: string | null | undefined): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(header?.trim() ?? '');
  return m ? m[1]! : null;
}

function defaultDeps(): BearerDeps {
  return {
    clientFor(token) {
      const env = readPublicEnv();
      if (!env) throw new Error('Supabase is not configured');
      return createClient(env.url, env.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
    },
  };
}

function pick(memberships: readonly HouseholdSummary[], requested: string | undefined): HouseholdSummary | AuthOutcome {
  if (requested !== undefined && requested !== '') {
    // Dev-only e2e sandbox ids (`e2e-*`) are accepted in mock auth mode exactly as getMockIdentity() does; never in production.
    const sandbox = resolveAuthMode() === 'mock' && MOCK_SANDBOX_PATTERN.test(requested);
    if (!isUuid(requested) && !sandbox) return fail(400, 'Invalid household.');
    return memberships.find((m) => m.id === requested) ?? fail(403, 'You are not a member of that household.');
  }
  if (memberships.length === 1) return memberships[0]!;
  return fail(400, 'Say which household this is for.');
}

/** Verify a Supabase access token and the household membership. Exported with injectable deps for tests. */
export async function resolveBearerAuth(token: string, requestedHouseholdId: string | undefined, deps: BearerDeps = defaultDeps()): Promise<AuthOutcome> {
  let client: SupabaseClient;
  try {
    client = deps.clientFor(token);
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) return fail(401, 'Your sign-in was not accepted. Please sign in again.');
    const memberships = await loadMemberships(client, data.user.id);
    if (!memberships.ok) return fail(403, 'Your households could not be checked.');
    const chosen = pick(memberships.data, requestedHouseholdId);
    if ('ok' in chosen) return chosen;
    return {
      ok: true,
      auth: {
        userId: data.user.id,
        householdId: chosen.id,
        readOnly: isReadOnly(chosen),
        dataContext: { client, householdId: chosen.id, userId: data.user.id },
      },
    };
  } catch {
    return fail(401, 'Your sign-in was not accepted. Please sign in again.');
  }
}

/** Bearer token when present (Android), else the cookie session (web). `requestedHouseholdId` is only ever narrowed to a membership. */
export async function resolveRequestAuth(req: Request, requestedHouseholdId?: string, deps?: BearerDeps): Promise<AuthOutcome> {
  const token = bearerToken(req.headers.get('authorization'));
  if (token) {
    if (resolveAuthMode() !== 'supabase') return fail(401, 'Bearer sign-in needs Supabase auth.');
    return resolveBearerAuth(token, requestedHouseholdId, deps);
  }
  const ctx = await getHouseholdContext();
  if (!ctx) return fail(401, 'Please sign in.');
  const chosen = requestedHouseholdId ? pick(ctx.memberships, requestedHouseholdId) : ctx.household;
  if ('ok' in chosen) return chosen;
  return {
    ok: true,
    auth: {
      userId: ctx.user.id,
      householdId: chosen.id,
      readOnly: isReadOnly(chosen),
      dataContext: ctx.mode === 'supabase' ? { client: ctx.supabase, householdId: chosen.id, userId: ctx.user.id } : null,
    },
  };
}
