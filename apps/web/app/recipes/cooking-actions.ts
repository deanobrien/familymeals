'use server';

import { revalidatePath } from 'next/cache';
import { getRecipeRepository } from '../../lib/recipes/factory';
import { settingsAiProvider } from '../../lib/server/ai/provider';
import { webCookingCaller } from '../../lib/server/cooking/web-caller';
import * as cooking from '../../lib/server/cooking/service';
import type { CookingResult, CookEntry, RecipeCookingView } from '../../lib/server/cooking/service';
import { suggestSubstitutionsFor, type SubstitutionOutcome } from '../../lib/server/cooking/substitutions';
import { saveVariant, type VariantResult } from '../../lib/server/cooking/variant';
import { loadPlanServices } from '../../lib/server/plan/services';

/**
 * Cooking (P1-A, D360-D369): cook mode's "mark as cooked", ratings and notes, "don't suggest again", and substitutions.
 * Thin wrappers over lib/server/cooking, the same modules the Android app reaches through /api/recipes/[id]/... The
 * household and user always come from the server-resolved session, never the form.
 */

const caller = webCookingCaller;

function refresh(recipeId: string): void {
  revalidatePath('/recipes');
  revalidatePath(`/recipes/${recipeId}`);
  revalidatePath('/plan');
}

export async function loadCookingAction(recipeId: string): Promise<CookingResult<{ cooking: RecipeCookingView }>> {
  return cooking.loadCooking(await caller(), recipeId);
}

export async function markCookedAction(
  recipeId: string,
  values: { servings: number; rating?: number | null; note?: string | null; notePrivate?: boolean },
): Promise<CookingResult<{ entry: CookEntry; cooking: RecipeCookingView }>> {
  const r = await cooking.markCooked(await caller(), recipeId, values);
  if (r.ok) refresh(recipeId);
  return r;
}

export async function setDontSuggestAction(recipeId: string, value: boolean): Promise<CookingResult<{ cooking: RecipeCookingView }>> {
  const r = await cooking.setDontSuggest(await caller(), recipeId, value === true);
  if (r.ok) refresh(recipeId);
  return r;
}

export async function suggestSubstitutionsAction(recipeId: string, lineId: string): Promise<SubstitutionOutcome> {
  const c = await caller();
  const recipe = await getRecipeRepository().get(recipeId);
  if (!recipe) return { ok: false, code: 'NOT_FOUND', message: 'Recipe not found.' };
  const svc = await loadPlanServices(c.householdId);
  return suggestSubstitutionsFor({ recipe, lineId: String(lineId), household: svc.household, ai: settingsAiProvider, householdId: c.householdId });
}

export async function saveVariantAction(recipeId: string, input: { swaps: Array<{ lineId: string; name: string; guidance?: string }>; title?: string }): Promise<VariantResult> {
  const c = await caller();
  if (c.readOnly) return { ok: false, code: 'SAVE_FAILED', message: 'This household is read-only while it is pending deletion.' };
  const svc = await loadPlanServices(c.householdId);
  const r = await saveVariant({ repo: getRecipeRepository(), recipeId, raw: input, household: svc.household });
  if (r.ok) revalidatePath('/recipes');
  return r;
}
