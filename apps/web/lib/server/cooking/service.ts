import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getRecipeRepositoryFor } from '../../recipes/factory';
import { getDataContext, useSupabaseBackend } from '../supabase/backend';
import { MemoryCookingStore } from './memory-store';
import { SupabaseCookingStore } from './supabase-store';
import { CookingError, type CookEntry, type CookSummary, type CookingStore, type RecipeCookingView } from './types';

export type { CookEntry, CookSummary, RecipeCookingView } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const markCookedSchema = z.object({
  servings: z.number().int().min(1, 'At least 1 serving').max(100, 'At most 100 servings'),
  rating: z.number().int().min(1).max(5).nullish(),
  note: z.string().trim().max(1000, 'Keep the note under 1000 characters').nullish(),
  notePrivate: z.boolean().optional(),
});

/** Who is asking: the verified user + household and their own client (null in mock auth mode). Never from the request body. */
export interface CookingCaller {
  householdId: string;
  userId: string;
  client: SupabaseClient | null;
  readOnly: boolean;
}

export type CookingError_ = 'not_found' | 'forbidden' | 'read_only' | 'invalid_input' | 'unknown';
export type CookingResult<T> = ({ ok: true } & T) | { ok: false; error: CookingError_; fieldErrors?: Record<string, string> };

export function storeFor(caller: Pick<CookingCaller, 'client'>): CookingStore {
  return caller.client ? new SupabaseCookingStore(caller.client) : new MemoryCookingStore();
}

async function guard<T>(caller: CookingCaller, recipeId: string | null, write: boolean, fn: (s: CookingStore) => Promise<T>): Promise<CookingResult<T extends object ? T : { value: T }>> {
  if (write && caller.readOnly) return { ok: false, error: 'read_only' };
  if (recipeId !== null && !UUID.test(recipeId)) return { ok: false, error: 'not_found' };
  try {
    // Memory mode has no foreign key to lean on: the recipe must exist in THIS household's library.
    if (recipeId !== null && !caller.client && !(await getRecipeRepositoryFor(caller.householdId).get(recipeId))) return { ok: false, error: 'not_found' };
    const out = await fn(storeFor(caller));
    return { ok: true, ...((typeof out === 'object' && out !== null ? out : { value: out }) as object) } as CookingResult<T extends object ? T : { value: T }>;
  } catch (e) {
    if (e instanceof CookingError) return { ok: false, error: e.code };
    return { ok: false, error: 'unknown' };
  }
}

/** The recipe's cooking panel: history, the caller's rating, the don't-suggest flag. */
export const loadCooking = (caller: CookingCaller, recipeId: string): Promise<CookingResult<{ cooking: RecipeCookingView }>> =>
  guard(caller, recipeId, false, async (s) => ({ cooking: await s.view(caller.householdId, caller.userId, recipeId) }));

/** "Mark as cooked": a history row, plus the member's rating and a private (default) or household note. */
export async function markCooked(caller: CookingCaller, recipeId: string, raw: unknown): Promise<CookingResult<{ entry: CookEntry; cooking: RecipeCookingView }>> {
  const r = markCookedSchema.safeParse(raw);
  if (!r.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of r.error.issues) {
      const k = String(i.path[0] ?? 'form');
      if (!(k in fieldErrors)) fieldErrors[k] = i.message;
    }
    return { ok: false, error: 'invalid_input', fieldErrors };
  }
  return guard(caller, recipeId, true, async (s) => {
    const entry = await s.markCooked(caller.householdId, caller.userId, recipeId, r.data);
    return { entry, cooking: await s.view(caller.householdId, caller.userId, recipeId) };
  });
}

/** "Don't suggest this again": the planner skips the recipe while any member has it set. */
export const setDontSuggest = (caller: CookingCaller, recipeId: string, value: boolean): Promise<CookingResult<{ cooking: RecipeCookingView }>> =>
  guard(caller, recipeId, true, async (s) => {
    await s.setDontSuggest(caller.householdId, caller.userId, recipeId, value);
    return { cooking: await s.view(caller.householdId, caller.userId, recipeId) };
  });

export interface WithCooking {
  cooked?: CookSummary;
}

/**
 * Adds `cooked` (count + last cooked) to recipe cards and, in the in-memory demo, replaces `rating` with the household mean
 * of the ratings given while cooking (Supabase recipes already carry that mean). Failure leaves the recipes untouched: the
 * cards must not break because the cooking history could not be read.
 */
export async function withCooking<T extends { id: string; rating: number | null }>(caller: Pick<CookingCaller, 'householdId' | 'client'>, recipes: T[]): Promise<Array<T & WithCooking>> {
  if (recipes.length === 0) return recipes;
  try {
    const store = storeFor(caller);
    const [sums, means] = await Promise.all([store.summaries(caller.householdId), store.ratingMeans(caller.householdId)]);
    return recipes.map((r) => {
      const s = sums.get(r.id);
      const mean = means.get(r.id);
      return { ...r, ...(mean !== undefined ? { rating: mean } : {}), ...(s ? { cooked: s } : {}) };
    });
  } catch {
    return recipes;
  }
}

/**
 * What the planner reads from cooking (P1-A): recipes a member asked not to be offered again, and (in the in-memory demo)
 * the ratings given while cooking. Runs inside a verified data context (planner, bearer routes). Advisory input: a failure
 * returns nothing rather than failing a plan.
 */
export async function planSignals(householdId: string): Promise<{ dontSuggest: Set<string>; ratings: Map<string, number> }> {
  try {
    const store: CookingStore = useSupabaseBackend() ? new SupabaseCookingStore((await getDataContext()).client) : new MemoryCookingStore();
    const [dontSuggest, ratings] = await Promise.all([store.dontSuggestIds(householdId), store.ratingMeans(householdId)]);
    return { dontSuggest, ratings };
  } catch {
    return { dontSuggest: new Set(), ratings: new Map() };
  }
}
