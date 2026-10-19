import 'server-only';
import { requireHouseholdContext } from './auth/household-context';
import { MOCK_USER_NAME } from './auth/mock';

/**
 * The household/user every app lane scopes its data by (DECISIONS D35). Wraps getHouseholdContext():
 * signed out -> /sign-in, no household -> /household/new. In local mock-auth mode this is the seeded demo
 * user (Alice) in household A, or an isolated e2e sandbox household selected by the `fr_household` cookie.
 * Never take a household id from client input.
 */
export interface AppContext {
  householdId: string;
  householdName: string;
  userId: string;
  displayName: string;
  readOnly: boolean;
  mode: 'supabase' | 'mock';
}

export async function getAppContext(): Promise<AppContext> {
  const ctx = await requireHouseholdContext();
  return {
    householdId: ctx.household.id,
    householdName: ctx.household.name,
    userId: ctx.user.id,
    displayName: ctx.mode === 'mock' ? MOCK_USER_NAME : (ctx.user.email?.split('@')[0] ?? 'Member'),
    readOnly: ctx.readOnly,
    mode: ctx.mode,
  };
}
