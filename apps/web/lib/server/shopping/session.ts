import { cookies } from 'next/headers';
import { DEFAULT_HOUSEHOLD, HOUSEHOLD_COOKIE } from '../../shopping/types';

/**
 * Current household. Placeholder until auth + households (L1) land: a `fr_household` cookie
 * (used by e2e to isolate runs) falling back to a single demo household.
 * TODO(auth): derive from the signed-in user's household membership.
 */
export async function currentHouseholdId(): Promise<string> {
  const v = (await cookies()).get(HOUSEHOLD_COOKIE)?.value;
  return v && /^[\w-]{1,64}$/.test(v) ? v : DEFAULT_HOUSEHOLD;
}
