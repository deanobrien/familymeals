// Client for the nutrition goals JSON API (apps/web /api/goals, P3-B D430-D439) with a defensive parser: the contract belongs to
// the web app, so unknown parts are dropped and malformed ones fall back to the safe "nothing stored" state.
// Health-related data: it is the signed-in member's OWN state only, it is never cached on the phone, and nothing here is logged.
import { GOAL_IDS, isGoalId, isPortionShare, type GoalId } from '@fr/engine/nutrition';
import type { ServerApi } from './serverApi';

export interface MyGoals {
  consentActive: boolean;
  goals: GoalId[];
  portionShare: number;
  nudgePlan: boolean;
  adultConfirmed: boolean;
  wordingVersion: string | null;
}

export const NO_GOALS: MyGoals = { consentActive: false, goals: [], portionShare: 1, nudgePlan: false, adultConfirmed: false, wordingVersion: null };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function parseGoals(v: unknown): MyGoals {
  if (!isObj(v) || v.consentActive !== true) return { ...NO_GOALS };
  const chosen = new Set((Array.isArray(v.goals) ? v.goals : []).filter(isGoalId));
  return {
    consentActive: true,
    goals: GOAL_IDS.filter((g) => chosen.has(g)),
    portionShare: isPortionShare(v.portionShare) ? v.portionShare : 1,
    nudgePlan: v.nudgePlan === true,
    adultConfirmed: v.adultConfirmed === true,
    wordingVersion: typeof v.wordingVersion === 'string' ? v.wordingVersion : null,
  };
}

export interface SaveGoals {
  goals: GoalId[];
  portionShare: number;
  nudgePlan: boolean;
  /** Required the first time (and whenever no consent is on file). */
  consent: boolean;
  adultConfirmed: boolean;
}

export interface GoalsClient {
  load(): Promise<MyGoals>;
  save(input: SaveGoals): Promise<MyGoals>;
  /** Withdraws consent AND deletes the stored goals. */
  withdraw(): Promise<MyGoals>;
}

export function createGoalsClient(api: ServerApi, householdId: string): GoalsClient {
  const read = (body: unknown): MyGoals => parseGoals(isObj(body) ? body.goals : null);
  return {
    load: async () => read(await api.get<unknown>('/api/goals', { householdId })),
    save: async (input) => read(await api.post<unknown>('/api/goals', { householdId, action: 'save', ...input })),
    withdraw: async () => read(await api.post<unknown>('/api/goals', { householdId, action: 'withdraw' })),
  };
}
