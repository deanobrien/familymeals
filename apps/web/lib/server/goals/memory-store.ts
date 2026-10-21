import { GOAL_IDS, type GoalId } from '@fr/engine/nutrition';
import { EMPTY_GOALS, GoalsError, type GoalsState, type GoalsStore, type SaveGoalsInput } from './types';

interface Entry extends GoalsState {
  userId: string;
}

const g = globalThis as { __frGoalsMemory?: Map<string, Entry> };
const map = (): Map<string, Entry> => (g.__frGoalsMemory ??= new Map());
const key = (h: string, u: string) => `${h}|${u}`;

export function resetMemoryGoals(): void {
  g.__frGoalsMemory = undefined;
}

/** In-memory demo store (mock auth mode): per household + user, lost on restart, cleared by the dev reset. */
export class MemoryGoalsStore implements GoalsStore {
  async get(householdId: string, userId: string): Promise<GoalsState> {
    const e = map().get(key(householdId, userId));
    return e && e.consentActive ? { consentActive: true, goals: [...e.goals], portionShare: e.portionShare, nudgePlan: e.nudgePlan, adultConfirmed: e.adultConfirmed, wordingVersion: e.wordingVersion } : { ...EMPTY_GOALS };
  }
  async grantConsent(householdId: string, userId: string, wordingVersion: string): Promise<void> {
    const cur = map().get(key(householdId, userId));
    if (cur?.consentActive) return;
    map().set(key(householdId, userId), { ...EMPTY_GOALS, userId, consentActive: true, wordingVersion });
  }
  async save(householdId: string, userId: string, input: SaveGoalsInput): Promise<void> {
    const cur = map().get(key(householdId, userId));
    if (!cur?.consentActive) throw new GoalsError('consent_required');
    if (!input.adultConfirmed && !cur.adultConfirmed) throw new GoalsError('invalid_input');
    cur.goals = GOAL_IDS.filter((x) => input.goals.includes(x));
    cur.portionShare = input.portionShare;
    cur.nudgePlan = input.nudgePlan;
    cur.adultConfirmed = true;
  }
  async withdraw(householdId: string, userId: string): Promise<void> {
    map().delete(key(householdId, userId)); // consent withdrawn AND data deleted
  }
  async nudgeGoals(householdId: string): Promise<GoalId[]> {
    const out = new Set<GoalId>();
    for (const [k, e] of map()) if (k.startsWith(`${householdId}|`) && e.consentActive && e.nudgePlan) for (const x of e.goals) out.add(x);
    return GOAL_IDS.filter((x) => out.has(x));
  }
}
