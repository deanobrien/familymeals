// Backend selection + data context for the Supabase repositories (lane S1 D50-D59; session wiring D100-D102).
//
//   DATA_BACKEND=supabase AND the app's Supabase env (NEXT_PUBLIC_SUPABASE_URL + _ANON_KEY)  -> Supabase repositories
//   anything else                                                                            -> in-memory repositories
//
// Who is the household / user? THE SIGNED-IN USER: every repository call resolves `sessionDataContext()`
// (./session-context.ts), i.e. the L11 session's user-scoped client (RLS applies), active household and member id.
// There is no service role on this path.
//
// Documented dev fallback (never in production): DATA_BACKEND=supabase + SUPABASE_DATA_CONTEXT=service +
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + SUPABASE_DEFAULT_HOUSEHOLD_ID (+ optional SUPABASE_DEFAULT_USER_ID) runs
// every request as that one household with the service-role key (RLS bypassed; every query is still household-scoped
// by the repositories). Meant for scripts and a local stack with no sign-in. SUPABASE_DEFAULT_HOUSEHOLD_ID alone does nothing.
import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SupabaseMealPlanRepository, SupabasePlanRecipeSource, type PlanSourceOptions } from './meal-plan-repository';
import { SupabasePantryRepository } from './pantry-repository';
import { SupabaseRecipeRepository } from './recipe-repository';
import { SupabaseRestockRepository } from './restock-repository';
import type { RestockRepository } from '../restock/repository';
import { SupabaseReceiptRepository } from './receipt-repository';
import { SupabaseShoppingRepository } from './shopping-repository';
import { SupabaseStoreBookRepository } from './store-book-repository';
import type { StoreBookRepository } from '../stores/repository';
import { SupabaseHouseholdProfile, SupabasePurchaseEventSource } from './household-sources';
import type { EngineContext } from '../../shopping/engine';
import type { ShoppingRepository } from '../shopping/repository';
import type { ReceiptRepository } from '../receipts/ports';
import type { PurchaseEventSource } from '../pantry/sources';
import type { RecipeSummariser } from '../../recipes/memory-repository';
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

/** Builds the cost/nutrition summariser for one household (the same one the in-memory repository uses, D100). */
export type SummariserFor = (householdId: string) => RecipeSummariser;

type Env = Record<string, string | undefined>;

export interface SupabaseConfig {
  url: string;
  key: string;
}

/** Dev-fallback server config: service-role key. Returns null when the Supabase env is incomplete. */
export function readSupabaseConfig(env: Env = process.env): SupabaseConfig | null {
  const url = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

/** The app's public Supabase env (what the L11 session uses). */
export function hasSessionSupabase(env: Env = process.env): boolean {
  return !!env.NEXT_PUBLIC_SUPABASE_URL?.trim() && !!env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
}

/** The documented dev fallback: explicit opt-in, a household id, a service key, and never production. */
export function devServiceContextEnabled(env: Env = process.env): boolean {
  return (
    env.SUPABASE_DATA_CONTEXT === 'service' &&
    env.NODE_ENV !== 'production' &&
    !!env.SUPABASE_DEFAULT_HOUSEHOLD_ID &&
    readSupabaseConfig(env) !== null
  );
}

let warned = false;
/** True only when DATA_BACKEND=supabase and something can supply a data context (session env, dev fallback, or a provider). */
export function useSupabaseBackend(env: Env = process.env): boolean {
  if (env.DATA_BACKEND !== 'supabase') return false;
  if (customProvider || devServiceContextEnabled(env) || hasSessionSupabase(env)) return true;
  if (!warned) {
    warned = true;
    console.warn('[data] DATA_BACKEND=supabase but NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set: using in-memory repositories.');
  }
  return false;
}

let customProvider: DataContextProvider | undefined;
/** Override hook (tests, scripts): resolve {client, householdId, userId} from anything. Wins over the session. */
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

/** Resolution order: registered provider > documented dev service fallback > the signed-in session. */
export async function getDataContext(env: Env = process.env): Promise<DataContext> {
  if (customProvider) return customProvider();
  if (devServiceContextEnabled(env)) {
    const cfg = readSupabaseConfig(env)!;
    return { client: serviceClient(cfg), householdId: env.SUPABASE_DEFAULT_HOUSEHOLD_ID!, userId: env.SUPABASE_DEFAULT_USER_ID ?? null };
  }
  if (!hasSessionSupabase(env)) {
    throw new Error('Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY).');
  }
  // Dynamic import keeps next/headers out of module scope (unit tests, scripts).
  const { sessionDataContext } = await import('./session-context');
  return sessionDataContext();
}

/**
 * A repository that resolves its data context (client + household + member) on every call, so the same process-wide
 * instance serves different requests with each request's own session client and household.
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

export function createSupabaseRecipeRepository(
  resolve: () => Promise<DataContext> = getDataContext,
  summariserFor?: SummariserFor,
): RecipeRepository {
  return lazy(
    (c) => new SupabaseRecipeRepository({ client: c.client, householdId: c.householdId, userId: c.userId, summariser: summariserFor?.(c.householdId) }),
    resolve,
  );
}
export function createSupabaseMealPlanRepository(resolve: () => Promise<DataContext> = getDataContext): MealPlanRepository {
  return lazy((c) => new SupabaseMealPlanRepository(c.client, c.userId), resolve);
}
export function createSupabasePlanRecipeSource(
  resolve: () => Promise<DataContext> = getDataContext,
  opts: PlanSourceOptions = {},
): PlanRecipeSource {
  return lazy((c) => new SupabasePlanRecipeSource(c.client, c.userId, opts), resolve);
}
export function createSupabasePantryRepository(resolve: () => Promise<DataContext> = getDataContext): PantryRepository {
  return lazy((c) => new SupabasePantryRepository(c.client), resolve);
}

// ---- lane PR1 (D280-D289): minimum pantry stock (par levels) + restock settings ----
export function createSupabaseRestockRepository(resolve: () => Promise<DataContext> = getDataContext): RestockRepository {
  return lazy((c) => new SupabaseRestockRepository(c.client), resolve);
}

// ---- lane S2 (D120-D127): shopping, receipts, pantry purchase feed, planner profile ----
export function createSupabaseShoppingRepository(ctx: EngineContext, resolve: () => Promise<DataContext> = getDataContext): ShoppingRepository {
  return lazy((c) => new SupabaseShoppingRepository({ client: c.client, householdId: c.householdId, ctx }), resolve);
}
export function createSupabaseReceiptRepository(resolve: () => Promise<DataContext> = getDataContext): ReceiptRepository {
  return lazy((c) => new SupabaseReceiptRepository(c.client, c.householdId), resolve);
}
export function createSupabasePurchaseEventSource(resolve: () => Promise<DataContext> = getDataContext): PurchaseEventSource {
  return lazy((c) => new SupabasePurchaseEventSource(c.client, c.householdId), resolve);
}
export function createSupabaseHouseholdProfile(resolve: () => Promise<DataContext> = getDataContext): Pick<SupabaseHouseholdProfile, 'load' | 'favourites'> {
  return lazy((c) => new SupabaseHouseholdProfile(c.client, c.householdId), resolve);
}

// ---- lane AS1 (D290-D293): stores, aisles and placements ----
export function createSupabaseStoreBookRepository(resolve: () => Promise<DataContext> = getDataContext): StoreBookRepository {
  return lazy((c) => new SupabaseStoreBookRepository(c.client, c.userId), resolve);
}
