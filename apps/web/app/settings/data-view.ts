/** Settings > Your data view model (DX1). Built on the server by page.tsx; no secrets, no other members' data. */
export interface DataSettingsView {
  mode: 'supabase' | 'mock';
  isOwner: boolean;
  householdName: string;
  /** household pending deletion (read-only grace period) */
  readOnly: boolean;
  purgeAfter: string | null;
  accountDeletionAt: string | null;
  /** you are the only active member (account deletion schedules this household for deletion) */
  soleMember: boolean;
  /** you are the only owner and others are members (transfer ownership before deleting the account) */
  soleOwnerWithOthers: boolean;
  notice: string | null;
}

export const DEFAULT_DATA_VIEW: DataSettingsView = {
  mode: 'mock',
  isOwner: true,
  householdName: 'Your household',
  readOnly: false,
  purgeAfter: null,
  accountDeletionAt: null,
  soleMember: true,
  soleOwnerWithOthers: false,
  notice: null,
};

export const DATA_NOTICES: Record<string, string> = {
  household_deletion_scheduled: 'Household deletion scheduled. You have 14 days to cancel.',
  household_deletion_cancelled: 'Household deletion cancelled. The household is active again.',
  account_deletion_scheduled: 'Account deletion scheduled. It happens when your household deletion completes.',
  account_deletion_cancelled: 'Account deletion cancelled.',
};

export const DATA_ERRORS: Record<string, string> = {
  confirm_mismatch: 'The confirmation text did not match. Nothing was deleted.',
  reauth_failed: 'That password was not correct. Nothing was deleted.',
};

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
}

export function daysLeft(iso: string, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now.getTime()) / 86_400_000));
}
