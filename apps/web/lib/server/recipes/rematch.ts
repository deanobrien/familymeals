import 'server-only';
import type { RecipeRepository } from '../../recipes/repository';
import type { RecipeInput } from '../../recipes/schema';
import type { RecipeView } from '../../recipes/types';
import type { IngredientCatalogue } from '../refdata/catalogue';
import { suggestLink } from './ingredient-links';

/** "Re-match ingredients" backfill (D225). Works through the RecipeRepository, so memory and Supabase behave alike. */
export interface RematchSummary {
  recipes: number;
  /** Recipes that gained at least one link and were saved. */
  updated: number;
  /** Lines newly linked. */
  linked: number;
  /** Lines still without a link because the name matched several ingredients. */
  ambiguous: number;
  /** Lines still without a link (no match). */
  unmatched: number;
}

const EMPTY: RematchSummary = { recipes: 0, updated: 0, linked: 0, ambiguous: 0, unmatched: 0 };

function toInput(r: RecipeView, ids: Map<number, string>): RecipeInput {
  return {
    title: r.title,
    description: r.description,
    imageUrl: r.imageUrl,
    sourceAttribution: r.sourceAttribution,
    sourceUrl: r.sourceUrl,
    originalText: r.originalText,
    prepMinutes: r.prepMinutes,
    cookMinutes: r.cookMinutes,
    servings: r.servings,
    cuisine: r.cuisine,
    mealType: r.mealType,
    diet: r.diet,
    tags: [...r.tags],
    ingredients: r.ingredients.map((i, idx) => ({
      name: i.name,
      // Existing links are always re-sent unchanged; only previously unlinked lines can gain one.
      ingredientId: i.ingredientId ?? ids.get(idx),
      quantity: structuredClone(i.quantity),
      preparation: i.preparation,
      optional: i.optional,
    })),
    steps: r.steps.map((s) => s.text),
    ...(r.printedNutrition ? { printedNutrition: structuredClone(r.printedNutrition) } : {}),
    ...(r.printedAllergens ? { printedAllergens: [...r.printedAllergens] } : {}),
  };
}

/** Link the unlinked lines of ONE loaded recipe. Saves only when something new matched. */
async function rematchLoaded(repo: RecipeRepository, catalogue: IngredientCatalogue, r: RecipeView): Promise<RematchSummary> {
  const found = new Map<number, string>();
  let ambiguous = 0;
  let unmatched = 0;
  r.ingredients.forEach((line, idx) => {
    if (line.ingredientId) return;
    const s = suggestLink(catalogue, line.name);
    if (s.status === 'matched' && s.ingredientId) found.set(idx, s.ingredientId);
    else if (s.status === 'ambiguous') ambiguous += 1;
    else unmatched += 1;
  });
  if (found.size > 0) await repo.update(r.id, toInput(r, found));
  return { recipes: 1, updated: found.size > 0 ? 1 : 0, linked: found.size, ambiguous, unmatched };
}

/** Returns null when the recipe does not exist. */
export async function rematchRecipe(repo: RecipeRepository, catalogue: IngredientCatalogue, id: string): Promise<RematchSummary | null> {
  const r = await repo.get(id);
  return r ? rematchLoaded(repo, catalogue, r) : null;
}

const PAGE = 48;

/** Every recipe of the repository's household (paged), one save per recipe that gained a link. */
export async function rematchAllRecipes(repo: RecipeRepository, catalogue: IngredientCatalogue): Promise<RematchSummary> {
  const total = { ...EMPTY };
  for (let page = 1; page <= 1000; page++) {
    const res = await repo.list({ q: '', tags: [], sort: 'name', page, pageSize: PAGE });
    for (const r of res.items) {
      const s = await rematchLoaded(repo, catalogue, r);
      total.recipes += s.recipes;
      total.updated += s.updated;
      total.linked += s.linked;
      total.ambiguous += s.ambiguous;
      total.unmatched += s.unmatched;
    }
    if (page >= res.pageCount) break;
  }
  return total;
}
