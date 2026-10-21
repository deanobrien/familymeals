import type { SupabaseClient } from '@supabase/supabase-js';
import { GOAL_IDS, isGoalId, type GoalId } from '@fr/engine/nutrition';
import { EMPTY_GOALS, GoalsError, type GoalsState, type GoalsStore, type SaveGoalsInput } from './types';

type Row = Record<string, unknown>;

/** Postgres / PostgREST failures become fixed codes (never raw provider text). 42501 = RLS or missing consent. */
function fail(e: unknown): never {
  const code = (e as { code?: string } | null)?.code;
  if (code === '42501' || code === 'PGRST301') throw new GoalsError('consent_required');
  if (code === '23514' || code === '22P02' || code === '23503' || code === '22023') throw new GoalsError('invalid_input');
  throw new GoalsError('unknown');
}

async function run<T>(p: PromiseLike<{ data: T | null; error: unknown }>): Promise<T | null> {
  const { data, error } = await p;
  if (error) fail(error);
  return data;
}

/**
 * consent_records (type nutrition_goals) + nutrition_goal_profiles + nutrition_goals as the signed-in user. RLS is the
 * authority: only your own rows are visible, writes need an active consent (a policy, not just this code), withdrawing
 * deletes the data (trigger), leaving the household deletes it. Nothing here needs the service role.
 */
export class SupabaseGoalsStore implements GoalsStore {
  constructor(private readonly db: SupabaseClient) {}

  async get(householdId: string, userId: string): Promise<GoalsState> {
    const consent = await run<Row[]>(
      this.db.from('consent_records').select('wording_version').eq('household_id', householdId).eq('user_id', userId).eq('consent_type', 'nutrition_goals').is('withdrawn_at', null),
    );
    if (!consent || consent.length === 0) return { ...EMPTY_GOALS };
    const [profile, goals] = await Promise.all([
      run<Row>(this.db.from('nutrition_goal_profiles').select('portion_share, nudge_plan, adult_confirmed_at').eq('household_id', householdId).eq('user_id', userId).maybeSingle()),
      run<Row[]>(this.db.from('nutrition_goals').select('goal').eq('household_id', householdId).eq('user_id', userId)),
    ]);
    const chosen = new Set((goals ?? []).map((r) => r.goal).filter(isGoalId));
    return {
      consentActive: true,
      goals: GOAL_IDS.filter((x) => chosen.has(x)),
      portionShare: Number(profile?.portion_share ?? 1) || 1,
      nudgePlan: profile?.nudge_plan === true,
      adultConfirmed: !!profile?.adult_confirmed_at,
      wordingVersion: typeof consent[0]?.wording_version === 'string' ? consent[0].wording_version : null,
    };
  }

  async grantConsent(householdId: string, userId: string, wordingVersion: string): Promise<void> {
    const have = await run<Row[]>(
      this.db.from('consent_records').select('id').eq('household_id', householdId).eq('user_id', userId).eq('consent_type', 'nutrition_goals').is('withdrawn_at', null),
    );
    if ((have ?? []).length > 0) return;
    await run(this.db.from('consent_records').insert({ household_id: householdId, consent_type: 'nutrition_goals', wording_version: wordingVersion }));
  }

  async save(householdId: string, _userId: string, input: SaveGoalsInput): Promise<void> {
    const { error } = await this.db.rpc('set_nutrition_goals', {
      p_household_id: householdId,
      p_goals: input.goals,
      p_portion_share: input.portionShare,
      p_nudge_plan: input.nudgePlan,
      p_adult_confirmed: input.adultConfirmed,
    });
    if (error) fail(error);
  }

  async withdraw(householdId: string, userId: string): Promise<void> {
    // The trigger on consent_records deletes the profile and goals in the same transaction.
    await run(
      this.db.from('consent_records').update({ withdrawn_at: new Date().toISOString() }).eq('household_id', householdId).eq('user_id', userId).eq('consent_type', 'nutrition_goals').is('withdrawn_at', null),
    );
  }

  async nudgeGoals(householdId: string): Promise<GoalId[]> {
    const { data, error } = await this.db.rpc('planner_goal_nudge', { p_household_id: householdId });
    if (error) fail(error);
    return (Array.isArray(data) ? data : []).filter(isGoalId);
  }
}
