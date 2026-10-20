import 'server-only';
import { z } from 'zod';
import type { Household } from '@fr/plan-orchestrator';
import type { RecipeInput } from '../../recipes/schema';
import type { RecipeRepository } from '../../recipes/repository';
import type { RecipeView } from '../../recipes/types';
import { getIngredientCatalogue, type IngredientCatalogue } from '../refdata/catalogue';
import { saveRecipe } from '../recipes/service';
import { checkSubstitute } from './substitutions';

/**
 * "Save as a recipe variant" (P1-A, D365): a COPY of the recipe with the chosen ingredient swaps, saved as a new recipe.
 * The original is never touched. Every swap is re-checked against the household exclusions here too (the client only sends
 * names; it is not trusted), and the swapped line carries the guidance as its note so the cook sees how to adjust amounts.
 */

export const swapSchema = z.object({
  lineId: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(80),
  /** Quantity guidance from the suggestion, kept as the line's note. */
  guidance: z.string().trim().max(200).optional(),
});
export const variantSchema = z.object({
  swaps: z.array(swapSchema).min(1).max(20),
  title: z.string().trim().min(1).max(160).optional(),
});
export type VariantRequest = z.infer<typeof variantSchema>;

export type VariantResult =
  | { ok: true; id: string; title: string }
  | { ok: false; code: 'INVALID_INPUT' | 'NOT_FOUND' | 'EXCLUDED' | 'SAVE_FAILED'; message: string };

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The recipe as editable input, with `swaps` applied (pure; no checks). */
export function applySwaps(recipe: RecipeView, swaps: VariantRequest['swaps'], title?: string): RecipeInput {
  const by = new Map(swaps.map((s) => [s.lineId, s]));
  const swapped = recipe.ingredients.filter((i) => by.has(i.id));
  const defaultTitle = swapped.length === 1 ? `${recipe.title} (no ${swapped[0]!.name.toLowerCase()})` : `${recipe.title} (variant)`;
  const note = swapped.map((i) => `${i.name} swapped for ${by.get(i.id)!.name}`).join('; ');
  return {
    title: clip(title ?? defaultTitle, 160),
    description: clip([recipe.description, `Variant of "${recipe.title}": ${note}.`].filter(Boolean).join('\n\n'), 2000),
    imageUrl: recipe.imageUrl,
    sourceAttribution: recipe.sourceAttribution,
    sourceUrl: recipe.sourceUrl,
    originalText: recipe.originalText,
    prepMinutes: recipe.prepMinutes,
    cookMinutes: recipe.cookMinutes,
    servings: recipe.servings,
    cuisine: recipe.cuisine,
    mealType: recipe.mealType,
    diet: recipe.diet,
    tags: recipe.tags,
    ingredients: [...recipe.ingredients]
      .sort((a, b) => a.order - b.order)
      .map((i) => {
        const s = by.get(i.id);
        if (!s) {
          return { name: i.name, ...(i.ingredientId ? { ingredientId: i.ingredientId } : {}), quantity: i.quantity, ...(i.preparation ? { preparation: i.preparation } : {}), optional: i.optional };
        }
        // The new name is matched to the ingredient list when the recipe is saved; the amount stays as written, the guidance rides along.
        const prep = clip([`instead of ${i.name}`, s.guidance].filter(Boolean).join(': '), 200);
        return { name: s.name, quantity: i.quantity, preparation: prep, optional: i.optional };
      }),
    steps: [...recipe.steps].sort((a, b) => a.order - b.order).map((s) => s.text),
  };
}

export async function saveVariant(args: {
  repo: RecipeRepository;
  recipeId: string;
  raw: unknown;
  household: Pick<Household, 'hardExclusions'>;
  catalogue?: IngredientCatalogue | undefined;
}): Promise<VariantResult> {
  const parsed = variantSchema.safeParse(args.raw);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT', message: 'Choose which ingredients to swap.' };
  const catalogue = args.catalogue ?? getIngredientCatalogue();
  const recipe = await args.repo.get(args.recipeId);
  if (!recipe) return { ok: false, code: 'NOT_FOUND', message: 'Recipe not found.' };
  const lineIds = new Set(recipe.ingredients.map((i) => i.id));
  const seen = new Set<string>();
  for (const s of parsed.data.swaps) {
    if (!lineIds.has(s.lineId) || seen.has(s.lineId)) return { ok: false, code: 'INVALID_INPUT', message: 'One of those ingredients is not in this recipe.' };
    seen.add(s.lineId);
    // Fail safe: an excluded or unverifiable substitute is refused outright, whatever the client says it was.
    if (!checkSubstitute(s.name, s.guidance ?? '', args.household, catalogue).ok) {
      return { ok: false, code: 'EXCLUDED', message: 'One of those swaps cannot be used with your household exclusions.' };
    }
  }
  const input = applySwaps(recipe, parsed.data.swaps, parsed.data.title);
  const res = await saveRecipe(args.repo, catalogue, null, input, true);
  if (!res.ok) return { ok: false, code: 'SAVE_FAILED', message: res.message ?? 'The variant could not be saved.' };
  return { ok: true, id: res.id, title: input.title };
}
