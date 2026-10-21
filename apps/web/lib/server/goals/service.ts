import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { GOAL_IDS, GOALS_CONSENT_VERSION, isGoalId, isPortionShare, type GoalId } from '@fr/engine/nutrition';
import { MemoryGoalsStore } from './memory-store';
import { SupabaseGoalsStore } from './supabase-store';
import { GoalsError, type GoalsState, type GoalsStore } from './types';

export { GoalsError } from './types';
export type { GoalsState } from './types';

/** Who is asking: the verified user + household, and their own client (null in mock auth mode). Never from the request body. */
export interface GoalsCaller {
  householdId: string;
  userId: string;
  client: SupabaseClient | null;
  readOnly: boolean;
  /**
   * Seam for kids' mode (P3-A, not on main yet): a child profile can never hold goals. Absent = an ordinary account holder
   * (accounts are adults who confirm it when they opt in).
   */
  isChild?: boolean;
}

export type GoalsResult =
  | { ok: true; state: GoalsState }
  | { ok: false; error: 'forbidden' | 'read_only' | 'invalid_input' | 'consent_required' | 'unknown'; fieldErrors?: Record<string, string> };

export function storeFor(caller: Pick<GoalsCaller, 'client'>): GoalsStore {
  return caller.client ? new SupabaseGoalsStore(caller.client) : new MemoryGoalsStore();
}

export const saveGoalsSchema = z.object({
  /** Explicit, specific consent for this health-related data. Required the first time and whenever none is on file. */
  consent: z.boolean().default(false),
  adultConfirmed: z.boolean().default(false),
  goals: z.array(z.string()).max(GOAL_IDS.length).refine((g) => g.every(isGoalId), 'Unknown goal'),
  portionShare: z.number().refine(isPortionShare, 'Choose a portion size'),
  nudgePlan: z.boolean().default(false),
});

export const goalsToggleSchema = z.object({ consent: z.boolean().optional() });

function fieldErrors(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const k = String(i.path[0] ?? 'form');
    if (!(k in out)) out[k] = i.message;
  }
  return out;
}

async function guard(caller: GoalsCaller, write: boolean, fn: (s: GoalsStore) => Promise<void>): Promise<GoalsResult> {
  if (caller.isChild) return { ok: false, error: 'forbidden' };
  if (write && caller.readOnly) return { ok: false, error: 'read_only' };
  const store = storeFor(caller);
  try {
    await fn(store);
    return { ok: true, state: await store.get(caller.householdId, caller.userId) };
  } catch (e) {
    if (e instanceof GoalsError) return { ok: false, error: e.code };
    return { ok: false, error: 'unknown' };
  }
}

export const loadGoals = (caller: GoalsCaller): Promise<GoalsResult> => guard(caller, false, async () => undefined);

/**
 * Saves the member's goals. With no active consent, `consent: true` AND `adultConfirmed: true` are required (they are recorded
 * together, in order); without them NOTHING is stored and no consent record is made. An empty goal list with no consent is a
 * no-op, so opening the screen never creates data.
 */
export async function saveGoals(caller: GoalsCaller, raw: unknown): Promise<GoalsResult> {
  const r = saveGoalsSchema.safeParse(raw);
  if (!r.success) return { ok: false, error: 'invalid_input', fieldErrors: fieldErrors(r.error.issues) };
  const v = r.data;
  return guard(caller, true, async (s) => {
    const current = await s.get(caller.householdId, caller.userId);
    if (!current.consentActive) {
      if (!v.consent) {
        if (v.goals.length > 0 || v.nudgePlan) throw new GoalsError('consent_required');
        return; // nothing to store and nothing consented to
      }
      if (!v.adultConfirmed) throw new GoalsError('invalid_input');
      await s.grantConsent(caller.householdId, caller.userId, GOALS_CONSENT_VERSION);
    }
    await s.save(caller.householdId, caller.userId, {
      goals: GOAL_IDS.filter((x) => v.goals.includes(x)),
      portionShare: v.portionShare,
      nudgePlan: v.nudgePlan,
      adultConfirmed: v.adultConfirmed || current.adultConfirmed,
    });
  });
}

/** Withdraws consent and deletes the stored goals. Allowed while a household is read-only: removing data is never blocked. */
export async function withdrawGoals(caller: GoalsCaller): Promise<GoalsResult> {
  if (caller.isChild) return { ok: false, error: 'forbidden' };
  const store = storeFor(caller);
  try {
    await store.withdraw(caller.householdId, caller.userId);
    return { ok: true, state: await store.get(caller.householdId, caller.userId) };
  } catch (e) {
    return { ok: false, error: e instanceof GoalsError ? e.code : 'unknown' };
  }
}

/** The planner's anonymous list (D436): only goal ids from consenting members who opted in. Failure reads as "none" (advisory). */
export async function loadGoalNudge(householdId: string, client: SupabaseClient | null): Promise<GoalId[]> {
  try {
    return await storeFor({ client }).nudgeGoals(householdId);
  } catch {
    return [];
  }
}
