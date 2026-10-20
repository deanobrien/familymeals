'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getRecipeRepository } from '../../lib/recipes/factory';
import { recipeInputSchema } from '../../lib/recipes/schema';
import { getAppContext } from '../../lib/server/context';
import { getIngredientCatalogue } from '../../lib/server/refdata/catalogue';
import {
  resolveLinks,
  searchCatalogue,
  suggestLink,
  type IngredientCandidate,
  type LineLinkReport,
  type LinkSuggestion,
} from '../../lib/server/recipes/ingredient-links';
import { rematchAllRecipes, rematchRecipe, type RematchSummary } from '../../lib/server/recipes/rematch';

const idSchema = z.string().uuid();

export interface DuplicateHit {
  id: string;
  title: string;
}

export type SaveResult =
  | { ok: true; id: string; links: LineLinkReport[] }
  | { ok: false; fieldErrors: Record<string, string>; duplicates?: DuplicateHit[]; message?: string };

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
  const input = z
    .object({
      title: z.string().max(160),
      names: z.array(z.string().max(120)).max(100),
      excludeId: z.string().uuid().optional(),
    })
    .safeParse({ title, names: ingredientNames, excludeId });
  if (!input.success) return [];
  const hits = await getRecipeRepository().findDuplicates(
    { title: input.data.title, ingredientNames: input.data.names },
    input.data.excludeId,
  );
  return hits.map((h) => ({ id: h.id, title: h.title }));
}

/** Create (id = null) or update a recipe. Duplicates only block when `force` is false. */
export async function saveRecipeAction(id: string | null, raw: unknown, force = false): Promise<SaveResult> {
  if (id !== null && !idSchema.safeParse(id).success) {
    return { ok: false, fieldErrors: {}, message: 'Invalid recipe id' };
  }
  const parsed = recipeInputSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.');
      if (!(key in fieldErrors)) fieldErrors[key] = issue.message;
    }
    return { ok: false, fieldErrors };
  }
  const repo = getRecipeRepository();
  const input = parsed.data;

  if (!force) {
    const dupes = await repo.findDuplicates(
      { title: input.title, ingredientNames: input.ingredients.map((i) => i.name) },
      id ?? undefined,
    );
    if (dupes.length > 0) {
      return { ok: false, fieldErrors: {}, duplicates: dupes.map((d) => ({ id: d.id, title: d.title })) };
    }
  }

  // Link every line to the ingredient catalogue (D221): new/changed lines are matched here, unchanged lines and manual
  // choices are preserved against the previous version.
  const previous = id === null ? null : await repo.get(id);
  if (id !== null && !previous) return { ok: false, fieldErrors: {}, message: 'Recipe not found' };
  const { ingredients, report } = resolveLinks(getIngredientCatalogue(), input.ingredients, previous?.ingredients ?? null);
  const linked = { ...input, ingredients };

  if (id === null) {
    const created = await repo.create(linked);
    revalidatePath('/recipes');
    return { ok: true, id: created.id, links: report };
  }
  const updated = await repo.update(id, linked);
  if (!updated) return { ok: false, fieldErrors: {}, message: 'Recipe not found' };
  revalidatePath('/recipes');
  revalidatePath(`/recipes/${id}`);
  return { ok: true, id: updated.id, links: report };
}

const nameSchema = z.string().trim().min(1).max(120);

/** Live "Matched to" preview for ingredient names typed in the form (read-only; never writes). */
export async function previewIngredientLinksAction(names: string[]): Promise<LinkSuggestion[]> {
  await getAppContext();
  const parsed = z.array(nameSchema).max(100).safeParse(names);
  if (!parsed.success) return [];
  const catalogue = getIngredientCatalogue();
  return parsed.data.map((n) => suggestLink(catalogue, n));
}

/** Search the ingredient catalogue (names and aliases) for the picker. */
export async function searchIngredientsAction(query: string): Promise<IngredientCandidate[]> {
  await getAppContext();
  const parsed = z.string().trim().min(2).max(60).safeParse(query);
  if (!parsed.success) return [];
  return searchCatalogue(getIngredientCatalogue(), parsed.data);
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
