'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getRecipeRepository } from '../../lib/recipes/factory';
import { getAppContext } from '../../lib/server/context';
import { getIngredientCatalogue } from '../../lib/server/refdata/catalogue';
import type { IngredientCandidate, LinkSuggestion } from '../../lib/server/recipes/ingredient-links';
import { rematchAllRecipes, rematchRecipe, type RematchSummary } from '../../lib/server/recipes/rematch';
import {
  checkDuplicates,
  previewLinks,
  saveRecipe,
  searchIngredients,
  type DuplicateHit,
  type SaveResult,
} from '../../lib/server/recipes/service';

const idSchema = z.string().uuid();

// The shared service owns these types (the bearer JSON API uses them too); a 'use server' file may only export async
// functions, so they are re-exported type-only.
export type { DuplicateHit, SaveResult };

export async function toggleFavouriteAction(id: string): Promise<{ ok: boolean; favourite?: boolean }> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false };
  const r = await getRecipeRepository().toggleFavourite(parsed.data);
  if (!r) return { ok: false };
  revalidatePath('/recipes');
  revalidatePath(`/recipes/${r.id}`);
  return { ok: true, favourite: r.favourite };
}

export async function deleteRecipeAction(id: string): Promise<{ ok: false; message: string }> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, message: 'Invalid recipe id' };
  const removed = await getRecipeRepository().delete(parsed.data);
  if (!removed) return { ok: false, message: 'Recipe not found' };
  revalidatePath('/recipes');
  redirect('/recipes?deleted=1');
}

export async function duplicateRecipeAction(id: string): Promise<{ ok: false; message: string }> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, message: 'Invalid recipe id' };
  const copy = await getRecipeRepository().duplicate(parsed.data);
  if (!copy) return { ok: false, message: 'Recipe not found' };
  revalidatePath('/recipes');
  redirect(`/recipes/${copy.id}?duplicated=1`);
}

export async function checkDuplicatesAction(
  title: string,
  ingredientNames: string[],
  excludeId?: string,
): Promise<DuplicateHit[]> {
  return checkDuplicates(getRecipeRepository(), title, ingredientNames, excludeId);
}

/** Create (id = null) or update a recipe. Duplicates only block when `force` is false. */
export async function saveRecipeAction(id: string | null, raw: unknown, force = false): Promise<SaveResult> {
  const result = await saveRecipe(getRecipeRepository(), getIngredientCatalogue(), id, raw, force);
  if (result.ok) {
    revalidatePath('/recipes');
    if (id !== null) revalidatePath(`/recipes/${id}`);
  }
  return result;
}

/** Live "Matched to" preview for ingredient names typed in the form (read-only; never writes). */
export async function previewIngredientLinksAction(names: string[]): Promise<LinkSuggestion[]> {
  await getAppContext();
  return previewLinks(getIngredientCatalogue(), names);
}

/** Search the ingredient catalogue (names and aliases) for the picker. */
export async function searchIngredientsAction(query: string): Promise<IngredientCandidate[]> {
  await getAppContext();
  return searchIngredients(getIngredientCatalogue(), query);
}

export type RematchResult = { ok: true; summary: RematchSummary } | { ok: false; message: string };

/** "Re-match ingredients" on one recipe: links lines that have no link yet (existing links and choices are kept). */
export async function rematchRecipeAction(id: string): Promise<RematchResult> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, message: 'Invalid recipe id' };
  const ctx = await getAppContext();
  if (ctx.readOnly) return { ok: false, message: 'This household is read-only.' };
  const summary = await rematchRecipe(getRecipeRepository(), getIngredientCatalogue(), parsed.data);
  if (!summary) return { ok: false, message: 'Recipe not found' };
  revalidatePath('/recipes');
  revalidatePath(`/recipes/${parsed.data}`);
  return { ok: true, summary };
}

/** Backfill for the whole household library (same rule as the per-recipe action). */
export async function rematchAllRecipesAction(): Promise<RematchResult> {
  const ctx = await getAppContext();
  if (ctx.readOnly) return { ok: false, message: 'This household is read-only.' };
  const summary = await rematchAllRecipes(getRecipeRepository(), getIngredientCatalogue());
  revalidatePath('/recipes');
  return { ok: true, summary };
}
