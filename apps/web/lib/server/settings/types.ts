// Household settings shared by the web server actions and the Android JSON route (P0-D, D350). One module, two callers.

export interface MemberDislikes {
  /** The member's user id (the planner's member id in Supabase mode; a demo id in mock mode). */
  memberId: string;
  displayName: string;
  /** This is the signed-in user. */
  isSelf: boolean;
  /** Lower-case terms, e.g. "mushrooms". */
  terms: string[];
}

export interface HouseholdSettings {
  defaultServings: number;
  weeklyBudgetPence: number | null;
  /** Exclusion terms (lower case), oldest first. */
  exclusions: string[];
  /** The signed-in member has an active allergy-data consent for this household. */
  consentActive: boolean;
  /** Each household member with their soft dislikes (P1-B, D378). Never allergies: no consent, never filters anything. */
  members: MemberDislikes[];
  /** The signed-in user may edit every member's dislikes (household owner); otherwise only their own. */
  canEditAllDislikes: boolean;
  /** Allergy exclusions the planner is NOT applying because the recorder's consent is missing or withdrawn (a count only). */
  withheldExclusions: number;
}

export type SettingsErrorCode = 'forbidden' | 'invalid_input' | 'unknown';

export class SettingsError extends Error {
  constructor(
    readonly code: SettingsErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'SettingsError';
  }
}

/** Storage port: Supabase (as the signed-in user, RLS decides) or the in-memory demo store. */
export interface SettingsStore {
  get(householdId: string, userId: string): Promise<HouseholdSettings>;
  /** Owner only (RLS in Supabase). */
  savePreferences(householdId: string, prefs: { defaultServings: number; weeklyBudgetPence: number | null }): Promise<void>;
  /** Replaces the household's exclusion list; records the member's consent when `tags` is not empty. */
  saveExclusions(householdId: string, userId: string, tags: string[]): Promise<void>;
  /** Withdraws the member's consent but keeps the list: it stays on file and the planner stops applying it. */
  withdrawConsent(householdId: string, userId: string): Promise<void>;
  /** Deletes every exclusion and withdraws the member's consent. */
  removeAllDietary(householdId: string, userId: string): Promise<void>;
  /** Replaces one member's soft dislikes (own list, or any list for the owner; RLS decides in Supabase). */
  saveDislikes(householdId: string, actorUserId: string, memberId: string, terms: string[]): Promise<void>;
}
