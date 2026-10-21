// Per-person nutrition goals (P3-B, D430-D439): shared by the web server actions and the Android JSON route. One module, two callers.
// Special category (health-related) data: consent-gated, own rows only, never sent to AI providers, never shown to other members.
import type { GoalId } from '@fr/engine/nutrition';

/** The signed-in member's own goals state. When `consentActive` is false nothing else is stored or returned. */
export interface GoalsState {
  consentActive: boolean;
  /** Chosen goals (fixed order). Empty unless consent is active. */
  goals: GoalId[];
  /** Usual portion as a share of one recipe serving (0.25 - 2). */
  portionShare: number;
  /** Let the planner favour the household's goals (anonymous ids only). */
  nudgePlan: boolean;
  /** The person confirmed they are an adult. */
  adultConfirmed: boolean;
  /** The consent wording version on file, when active. */
  wordingVersion: string | null;
}

export const EMPTY_GOALS: GoalsState = { consentActive: false, goals: [], portionShare: 1, nudgePlan: false, adultConfirmed: false, wordingVersion: null };

export type GoalsErrorCode = 'forbidden' | 'invalid_input' | 'consent_required' | 'unknown';

export class GoalsError extends Error {
  constructor(readonly code: GoalsErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'GoalsError';
  }
}

export interface SaveGoalsInput {
  goals: GoalId[];
  portionShare: number;
  nudgePlan: boolean;
  adultConfirmed: boolean;
}

/** Storage port: Supabase (as the signed-in user, RLS + triggers decide) or the in-memory demo store. */
export interface GoalsStore {
  get(householdId: string, userId: string): Promise<GoalsState>;
  /** Records the member's separate nutrition_goals consent (idempotent while one is active). */
  grantConsent(householdId: string, userId: string, wordingVersion: string): Promise<void>;
  /** Replaces the member's goals; refused (consent_required) without an active consent. */
  save(householdId: string, userId: string, input: SaveGoalsInput): Promise<void>;
  /** Withdraws the consent AND deletes the stored goals. */
  withdraw(householdId: string, userId: string): Promise<void>;
  /** Anonymous, deduplicated goal ids of members who consented and opted in to the planner nudge. */
  nudgeGoals(householdId: string): Promise<GoalId[]>;
}
