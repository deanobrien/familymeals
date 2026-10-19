'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getRecipeRepository } from '../../lib/recipes/factory';
import { recipeInputSchema } from '../../lib/recipes/schema';

const idSchema = z.string().uuid();

export interface DuplicateHit {
  id: string;
  title: string;
}

export type SaveResult =
  | { ok: true; id: string }
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

  if (id === null) {
    const created = await repo.create(input);
    revalidatePath('/recipes');
    return { ok: true, id: created.id };
  }
  const updated = await repo.update(id, input);
  if (!updated) return { ok: false, fieldErrors: {}, message: 'Recipe not found' };
  revalidatePath('/recipes');
  revalidatePath(`/recipes/${id}`);
  return { ok: true, id: updated.id };
}
