// Household-scoped recipe cost/nutrition summarisers (D100, D101). The SAME summariser backs the in-memory and the
// Supabase recipe repositories, so a recipe costs the same whichever backend is active.
import 'server-only';
import type { RecipeSummariser } from '../../recipes/memory-repository';
import type { SummariserFor } from '../supabase/backend';
import { getGenericRecipeCalculator, getRecipeCalculator } from './index';

/** Summariser for ONE known household (Supabase mode: the household is part of the data context). */
export const summariserForHousehold: SummariserFor = (householdId) => ({
  summarise: (recipe) => getRecipeCalculator(householdId).summarise(recipe),
});

/**
 * Summariser for the in-memory repository, which is process-wide and household-agnostic: resolves the signed-in
 * household per call and costs with THAT household's price observations. Outside a request (tests, scripts) or when
 * signed out there is no household, so only the generic refdata prices apply.
 */
export function createSessionSummariser(resolveHouseholdId: () => Promise<string | null>): RecipeSummariser {
  const calculatorOf = (householdId: string | null) => (householdId ? getRecipeCalculator(householdId) : getGenericRecipeCalculator());
  return {
    async summarise(recipe) {
      return calculatorOf(await resolveHouseholdId()).summarise(recipe);
    },
    // The repository resolves the household ONCE per operation (a list of 200 recipes must not do 200 session lookups).
    async forRequest() {
      const calc = calculatorOf(await resolveHouseholdId());
      return { summarise: (recipe) => calc.summarise(recipe) };
    },
  };
}

async function currentHouseholdId(): Promise<string | null> {
  try {
    // Imported lazily: next/headers only works inside a request, and a failure here must fall back, never throw.
    const { getHouseholdContext } = await import('../auth/household-context');
    return (await getHouseholdContext())?.household.id ?? null;
  } catch {
    return null;
  }
}

export const sessionRecipeSummariser: RecipeSummariser = createSessionSummariser(currentHouseholdId);
