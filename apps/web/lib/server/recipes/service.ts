import 'server-only';
import { z } from 'zod';
import type { RecipeRepository } from '../../recipes/repository';
import { recipeInputSchema } from '../../recipes/schema';
import type { IngredientCatalogue } from '../refdata/catalogue';
import {
  resolveLinks,
  searchCatalogue,
  suggestLink,
  type IngredientCandidate,
  type LineLinkReport,
  type LinkSuggestion,
} from './ingredient-links';

/**
 * The recipe-library operations shared by the web server actions and the bearer JSON API (the Android app). Every
 * function takes its dependencies explicitly, so the caller decides which household's repository is used and nothing
 * here touches cookies, redirects or the Next cache.
 */

const idSchema = z.string().uuid();
const nameSchema = z.string().trim().min(1).max(120);

export interface DuplicateHit {
  id: string;
  title: string;
}

export type SaveResult =
  | { ok: true; id: string; links: LineLinkReport[] }
  | { ok: false; fieldErrors: Record<string, string>; duplicates?: DuplicateHit[]; message?: string };

/** Create (id = null) or update a recipe. Duplicates only block when `force` is false. */
export async function saveRecipe(
  repo: RecipeRepository,
  catalogue: IngredientCatalogue,
  id: string | null,
  raw: unknown,
  force = false,
): Promise<SaveResult> {
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
  const { ingredients, report } = resolveLinks(catalogue, input.ingredients, previous?.ingredients ?? null);
  const linked = { ...input, ingredients };

  if (id === null) {
    const created = await repo.create(linked);
    return { ok: true, id: created.id, links: report };
  }
  const updated = await repo.update(id, linked);
  if (!updated) return { ok: false, fieldErrors: {}, message: 'Recipe not found' };
  return { ok: true, id: updated.id, links: report };
}

/** Recipes that look like the candidate; invalid input yields no hits (never an error). */
export async function checkDuplicates(
  repo: RecipeRepository,
  title: string,
  names: string[],
  excludeId?: string,
): Promise<DuplicateHit[]> {
  const input = z
    .object({
      title: z.string().max(160),
      names: z.array(z.string().max(120)).max(100),
      excludeId: z.string().uuid().optional(),
    })
    .safeParse({ title, names, excludeId });
  if (!input.success) return [];
  const hits = await repo.findDuplicates({ title: input.data.title, ingredientNames: input.data.names }, input.data.excludeId);
  return hits.map((h) => ({ id: h.id, title: h.title }));
}

/** Live "Matched to" preview for ingredient names typed in the form (read-only; never writes). */
export function previewLinks(catalogue: IngredientCatalogue, names: string[]): LinkSuggestion[] {
  const parsed = z.array(nameSchema).max(100).safeParse(names);
  if (!parsed.success) return [];
  return parsed.data.map((n) => suggestLink(catalogue, n));
}

/** Search the ingredient catalogue (names and aliases) for the picker. */
export function searchIngredients(catalogue: IngredientCatalogue, query: string): IngredientCandidate[] {
  const parsed = z.string().trim().min(2).max(60).safeParse(query);
  if (!parsed.success) return [];
  return searchCatalogue(catalogue, parsed.data);
}
