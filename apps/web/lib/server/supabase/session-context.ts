// The Supabase data context of the signed-in user (D100): the L11 session's user-scoped client (RLS applies), the
// active household and the member id. Built on pass-2's household context, i.e. the same source `getAppContext()` wraps.
import 'server-only';
import { requireHouseholdContext } from '../auth/household-context';
import type { DataContext } from './backend';

/** Signed out -> /sign-in, no household -> /household/new (redirects, as everywhere else in the app). */
export async function sessionDataContext(): Promise<DataContext> {
  const ctx = await requireHouseholdContext();
  if (ctx.mode !== 'supabase') {
    throw new Error('DATA_BACKEND=supabase needs real Supabase auth (mock-auth demo mode has no database client).');
  }
  return { client: ctx.supabase, householdId: ctx.household.id, userId: ctx.user.id };
}
