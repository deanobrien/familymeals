// Backend selection + data context for the Supabase repositories (lane S1, DECISIONS D50-D59).
//
//   DATA_BACKEND=supabase AND a Supabase URL + key present  -> Supabase repositories
//   anything else                                           -> in-memory repositories (today's behaviour)
//
// Who is the household / user? The auth lane will call `setDataContextProvider()` with a function that reads the session
// (user-scoped client, so RLS applies). Until then the interim provider uses the service-role key (RLS bypassed - every
// query is still household-scoped by the repositories) and a household from SUPABASE_DEFAULT_HOUSEHOLD_ID.
import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SupabaseMealPlanRepository, SupabasePlanRecipeSource } from './meal-plan-repository';
import { SupabasePantryRepository } from './pantry-repository';
import { SupabaseRecipeRepository } from './recipe-repository';
import type { RecipeRepository } from '../../recipes/repository';
import type { MealPlanRepository } from '../plan/repository';
import type { PlanRecipeSource } from '../plan/recipe-source';
import type { PantryRepository } from '../pantry/repository';

export interface DataContext {
  client: SupabaseClient;
  householdId: string;
  /** null = service context (no per-member favourites / created_by). */
  userId: string | null;
}
export type DataContextProvider = () => Promise<DataContext> | DataContext;

type Env = Record<string, string | undefined>;

export interface SupabaseConfig {
  url: string;
  key: string;
}

/** Interim server config: service-role key. Returns null when the Supabase env is incomplete. */
export function readSupabaseConfig(env: Env = process.env): SupabaseConfig | null {
  const url = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

let warned = false;
/** True only when DATA_BACKEND=supabase and the env needed to reach it is present (or a provider is registered). */
export function useSupabaseBackend(env: Env = process.env): boolean {
  if (env.DATA_BACKEND !== 'supabase') return false;
  if (readSupabaseConfig(env) || customProvider) return true;
  if (!warned) {
    warned = true;
    console.warn('[data] DATA_BACKEND=supabase but SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set: using in-memory repositories.');
  }
  return false;
}

let customProvider: DataContextProvider | undefined;
/** Auth lane hook: resolve {client, householdId, userId} from the current request. */
export function setDataContextProvider(p: DataContextProvider | undefined): void {
  customProvider = p;
}

const CLIENT_KEY = Symbol.for('fr.supabase.client');
type Holder = { [CLIENT_KEY]?: { cfg: SupabaseConfig; client: SupabaseClient } };

function serviceClient(cfg: SupabaseConfig): SupabaseClient {
  const g = globalThis as Holder;
  const cur = g[CLIENT_KEY];
  if (cur && cur.cfg.url === cfg.url && cur.cfg.key === cfg.key) return cur.client;
  const client = createClient(cfg.url, cfg.key, { auth: { persistSession: false, autoRefreshToken: false } });
  g[CLIENT_KEY] = { cfg, client };
  return client;
}

export async function getDataContext(env: Env = process.env): Promise<DataContext> {
  if (customProvider) return customProvider();
  const cfg = readSupabaseConfig(env);
  if (!cfg) throw new Error('Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
  const householdId = env.SUPABASE_DEFAULT_HOUSEHOLD_ID;
  if (!householdId) throw new Error('No household context: set SUPABASE_DEFAULT_HOUSEHOLD_ID (interim) or register setDataContextProvider().');
  return { client: serviceClient(cfg), householdId, userId: env.SUPABASE_DEFAULT_USER_ID ?? null };
}

/**
 * A repository that resolves its data context (client + household + member) on every call, so the same process-wide
 * instance serves different requests once the auth lane supplies a per-request context.
 */
function lazy<T extends object>(build: (ctx: DataContext) => T, resolve: () => Promise<DataContext>): T {
  return new Proxy({} as T, {
    get: (_t, prop) => {
      if (prop === 'then') return undefined; // not a thenable
      return async (...args: unknown[]) => {
        const target = build(await resolve()) as Record<PropertyKey, unknown>;
        const fn = target[prop];
        if (typeof fn !== 'function') throw new Error(`Unknown repository method ${String(prop)}`);
        return (fn as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}

export function createSupabaseRecipeRepository(resolve: () => Promise<DataContext> = getDataContext): RecipeRepository {
  return lazy((c) => new SupabaseRecipeRepository({ client: c.client, householdId: c.householdId, userId: c.userId }), resolve);
}
export function createSupabaseMealPlanRepository(resolve: () => Promise<DataContext> = getDataContext): MealPlanRepository {
  return lazy((c) => new SupabaseMealPlanRepository(c.client, c.userId), resolve);
}
export function createSupabasePlanRecipeSource(resolve: () => Promise<DataContext> = getDataContext): PlanRecipeSource {
  return lazy((c) => new SupabasePlanRecipeSource(c.client, c.userId), resolve);
}
export function createSupabasePantryRepository(resolve: () => Promise<DataContext> = getDataContext): PantryRepository {
  return lazy((c) => new SupabasePantryRepository(c.client), resolve);
}
