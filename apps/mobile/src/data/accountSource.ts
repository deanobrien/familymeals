/**
 * Account, household and "Your data" operations (lane P0-A, Android parity with the web `(auth)`, `household`, `invite` and
 * `settings` pages). Kept apart from `DataSource` so the shopping/recipe data layer other lanes edit is untouched;
 * `DataSource.account` points here. Every method throws an `AccountError` (fixed, user-safe text) on failure.
 */
import type { Uuid } from '@fr/domain';

export type HouseholdRole = 'owner' | 'member';
export type HouseholdStatus = 'active' | 'pending_deletion';

export interface HouseholdSummary {
  id: Uuid;
  name: string;
  status: HouseholdStatus;
  role: HouseholdRole;
  defaultServings: number;
  weeklyBudgetPence: number | null;
  /** households.purge_after while pending deletion (the end of the 14-day grace period) */
  purgeAfter: string | null;
  joinedAt: string;
}

export interface MemberSummary {
  id: Uuid;
  userId: Uuid;
  role: HouseholdRole;
  displayName: string;
  joinedAt: string;
  isYou: boolean;
}

export interface PendingInvitation {
  id: Uuid;
  email: string | null;
  role: HouseholdRole;
  expiresAt: string;
  expired: boolean;
}

export interface CreatedInvitation {
  invitationId: Uuid;
  /** The full link to share. It carries the one-time token: show it once, never store or log it. */
  link: string;
  expiresAt: string;
}

export interface CreateHouseholdInput {
  name: string;
  defaultServings: number;
  /** integer pence, or null for no budget */
  weeklyBudgetPence: number | null;
  displayName?: string | undefined;
}

export interface Exclusion {
  id: Uuid;
  term: string;
}

export interface AccountSettings {
  defaultServings: number;
  weeklyBudgetPence: number | null;
  exclusions: Exclusion[];
  /** The signed-in member has an active allergy-data consent for this household. */
  consentActive: boolean;
  /** Allergy exclusions the planner is NOT applying because the recorder's consent is missing (a count only). */
  withheldExclusions: number;
}

export interface Lifecycle {
  /** pending account deletion time (my_account_deletion) */
  accountDeletionAt: string | null;
  activeMembers: number;
  otherOwners: number;
}

export interface SignUpResult {
  /** A session exists already (email confirmation is off on the project): go on to onboarding. */
  signedIn: boolean;
}

export interface AccountSource {
  // ---- sign-up, confirmation, recovery ----------------------------------------------------------------------
  /** Email + password (>= 10 characters). Sends the confirmation email whose link opens `familyrecipes://auth/callback`. */
  signUp(email: string, password: string): Promise<SignUpResult>;
  /** Same outcome for unknown, pending and confirmed addresses (no enumeration); only a rate limit is reported. */
  resendConfirmation(email: string): Promise<void>;
  /** Always resolves the same way, whether or not the address exists (threat A5). */
  requestPasswordReset(email: string): Promise<void>;
  /** Set a new password for the session established by a recovery link. */
  updatePassword(password: string): Promise<void>;

  // ---- households -------------------------------------------------------------------------------------------
  listMemberships(): Promise<HouseholdSummary[]>;
  createHousehold(input: CreateHouseholdInput): Promise<{ id: Uuid }>;
  listMembers(householdId: Uuid): Promise<MemberSummary[]>;
  /** Owner-only under RLS: a member gets an empty list. */
  listInvitations(householdId: Uuid): Promise<PendingInvitation[]>;
  createInvitation(input: { householdId: Uuid; email?: string | undefined; role: HouseholdRole; ttlHours: number }): Promise<CreatedInvitation>;
  revokeInvitation(householdId: Uuid, invitationId: Uuid): Promise<void>;
  removeMember(householdId: Uuid, memberId: Uuid): Promise<void>;
  transferOwnership(householdId: Uuid, memberId: Uuid): Promise<void>;
  leaveHousehold(householdId: Uuid): Promise<void>;
  /** `accept_invitation(p_token)`: any rejection (wrong, expired, used, revoked) reads the same. */
  acceptInvitation(token: string): Promise<{ householdId: Uuid }>;

  // ---- settings ---------------------------------------------------------------------------------------------
  getSettings(householdId: Uuid): Promise<AccountSettings>;
  /** Owner only (RLS). */
  savePreferences(householdId: Uuid, prefs: { defaultServings: number; weeklyBudgetPence: number | null }): Promise<void>;
  /** Replaces the household's exclusion list with `tags`; records the signed-in member's consent (needs `consent` when tags exist). */
  saveExclusions(householdId: Uuid, tags: string[], consent: boolean): Promise<void>;
  /** Deletes every exclusion and withdraws the member's consent. */
  removeAllDietary(householdId: Uuid): Promise<void>;

  // ---- Your data --------------------------------------------------------------------------------------------
  getLifecycle(householdId: Uuid): Promise<Lifecycle>;
  /** Owner; typed household name + current password (D258). Returns the end of the grace period. */
  requestHouseholdDeletion(householdId: Uuid, confirmName: string, password: string): Promise<{ purgeAfter: string }>;
  cancelHouseholdDeletion(householdId: Uuid): Promise<void>;
  /** Typed DELETE + current password. `signedOut` = nothing left to wait for, the session was ended. */
  requestAccountDeletion(confirmText: string, password: string): Promise<{ scheduledAt: string; signedOut: boolean }>;
  cancelAccountDeletion(): Promise<void>;
}
