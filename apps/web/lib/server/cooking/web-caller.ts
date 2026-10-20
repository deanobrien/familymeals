import 'server-only';
import { requireHouseholdContext } from '../auth/household-context';
import type { CookingCaller } from './service';

/** The signed-in web user as a cooking caller (cookie session): Supabase client in live mode, null in mock mode. */
export async function webCookingCaller(): Promise<CookingCaller> {
  const ctx = await requireHouseholdContext();
  return { householdId: ctx.household.id, userId: ctx.user.id, client: ctx.mode === 'supabase' ? ctx.supabase : null, readOnly: ctx.readOnly };
}
