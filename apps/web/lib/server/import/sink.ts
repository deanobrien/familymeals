import type { FinalisedRecipe, RecipeSummary } from '@fr/recipe-import';
import { getRecipeRepository, getRecipeRepositoryFor } from '../../recipes/factory';
import type { RequestAuth } from '../auth/request-auth';
import { summariserForHousehold } from '../calc/household';
import { createSupabaseRecipeRepository, useSupabaseBackend } from '../supabase/backend';
import type { RecipeRepository } from '../../recipes/repository';
import { recipeInputSchema, type RecipeInput } from '../../recipes/schema';
import type { DietCategory, Quantity } from '../../recipes/types';

/** Persistence boundary for imported recipes. TODO(Supabase): implement against recipes/recipe_versions tables. */
export interface RecipeSink {
  save(recipe: FinalisedRecipe): Promise<{ id: string }>;
  list(): Promise<RecipeSummary[]>;
  get(id: string): Promise<FinalisedRecipe | undefined>;
}

/** Standalone sink for unit tests (no shared store). */
export class InMemoryRecipeSink implements RecipeSink {
  private readonly items = new Map<string, FinalisedRecipe>();

  async save(recipe: FinalisedRecipe) {
    this.items.set(recipe.recipe.id, structuredClone(recipe));
    return { id: recipe.recipe.id };
  }
  async list(): Promise<RecipeSummary[]> {
    return [...this.items.values()].map((r) => ({
      id: r.recipe.id,
      title: r.recipe.title,
      ingredientNames: r.ingredients.map((i) => i.name),
      ingredientIds: r.ingredients.flatMap((i) => (i.ingredientId ? [i.ingredientId] : [])),
    }));
  }
  async get(id: string) {
    const r = this.items.get(id);
    return r ? structuredClone(r) : undefined;
  }
}

/** Default servings when the photo did not say (the review step lets the user change it later in the library). */
export const IMPORT_DEFAULT_SERVINGS = 4;

/**
 * Diet from the reviewed tags. Unknown defaults to 'meat': the conservative label, so an unlabelled dish is
 * never offered as vegetarian / vegan by the library filters or the planner.
 */
export function dietFromTags(tags: readonly string[]): DietCategory {
  const t = new Set(tags.map((x) => x.toLowerCase()));
  if (t.has('vegan')) return 'vegan';
  if (t.has('vegetarian') || t.has('veggie')) return 'vegetarian';
  if (t.has('fish') || t.has('seafood') || t.has('pescatarian')) return 'fish';
  return 'meat';
}

/** FinalisedRecipe (import payload) -> library RecipeInput. Throws if it does not satisfy the library schema. */
export function toRecipeInput(f: FinalisedRecipe): RecipeInput {
  const r = f.recipe;
  const ingredients = [...f.ingredients].sort((a, b) => a.order - b.order);
  const steps = [...f.steps].sort((a, b) => a.order - b.order).map((s) => s.text);
  const input: RecipeInput = {
    title: r.title,
    description: r.description ?? '',
    // Cover = front of the card, stored by the import pipeline in the local dev upload store (TODO Supabase Storage).
    imageUrl: r.imageRef ?? null,
    sourceAttribution: r.source ?? 'Imported from photo',
    // A discovered recipe links back to its page at the publisher (D170); a photo's printed reference stays text.
    sourceUrl: r.sourceReference && /^https?:\/\//i.test(r.sourceReference) ? r.sourceReference.slice(0, 500) : '',
    // Verbatim photo text (ingredient lines as written, then steps); write-once in the library.
    originalText: [...ingredients.map((i) => i.originalText), '', ...steps].join('\n'),
    prepMinutes: r.prepMinutes ?? null,
    cookMinutes: r.cookMinutes ?? null,
    servings: Math.max(1, Math.round(r.servings ?? IMPORT_DEFAULT_SERVINGS)),
    cuisine: r.cuisine ?? '',
    mealType: 'dinner',
    diet: dietFromTags(r.tags),
    tags: r.tags,
    ingredients: ingredients.map((i) => ({
      name: i.name,
      ...(i.ingredientId ? { ingredientId: i.ingredientId } : {}),
      quantity: i.quantity as Quantity,
      ...(i.preparation ? { preparation: i.preparation } : {}),
      optional: i.optional,
    })),
    steps,
    // Printed on the card: carried across labelled as source-provided, never presented as our calculation.
    ...(r.printedNutrition ? { printedNutrition: { ...r.printedNutrition } } : {}),
    ...(r.printedAllergens?.length ? { printedAllergens: [...r.printedAllergens] } : {}),
  };
  return recipeInputSchema.parse(input) as RecipeInput;
}

/**
 * Sink over the shared recipe repository (the library store), so an imported recipe appears at /recipes/[id]
 * with the id minted by finaliseDraft. The import provenance (original extraction, image refs) is kept beside it
 * in memory until the Supabase recipe_versions table takes over.
 */
export class RepositoryRecipeSink implements RecipeSink {
  private readonly finalised = new Map<string, FinalisedRecipe>();
  constructor(private readonly repo: RecipeRepository) {}

  async save(recipe: FinalisedRecipe) {
    const view = await this.repo.create(toRecipeInput(recipe), { id: recipe.recipe.id });
    this.finalised.set(view.id, structuredClone(recipe));
    return { id: view.id };
  }
  async list(): Promise<RecipeSummary[]> {
    const all = await this.repo.list({ q: '', tags: [], sort: 'name', page: 1, pageSize: 10_000 });
    return all.items.map((r) => ({
      id: r.id,
      title: r.title,
      ingredientNames: r.ingredients.map((i) => i.name),
      ingredientIds: r.ingredients.flatMap((i) => (i.ingredientId ? [i.ingredientId] : [])),
    }));
  }
  async get(id: string) {
    if (!(await this.repo.get(id))) return undefined;
    const r = this.finalised.get(id);
    return r ? structuredClone(r) : undefined;
  }
}

/**
 * The sink for an authenticated caller (D102). With the Supabase backend the recipe is saved through the CALLER's own
 * client and household (a bearer token from the Android app, or the web session), never a shared one; otherwise the
 * process-wide in-memory sink.
 */
export function recipeSinkFor(auth: Pick<RequestAuth, 'dataContext'> & Partial<Pick<RequestAuth, 'householdId'>>): RecipeSink {
  const ctx = auth.dataContext;
  if (ctx && useSupabaseBackend()) {
    return new RepositoryRecipeSink(createSupabaseRecipeRepository(async () => ctx, summariserForHousehold));
  }
  // Memory mode: the household's own library (D160), one sink per household so provenance stays beside its recipes.
  if (auth.householdId) {
    const map = (g.__frRecipeSinks ??= new Map<string, RecipeSink>());
    let sink = map.get(auth.householdId);
    if (!sink) map.set(auth.householdId, (sink = new RepositoryRecipeSink(getRecipeRepositoryFor(auth.householdId))));
    return sink;
  }
  return getRecipeSink();
}

const g = globalThis as unknown as { __frRecipeSink?: RecipeSink; __frRecipeSinks?: Map<string, RecipeSink> };
/** Process-wide sink over the shared recipe repository (survives Next dev module reloads). */
export function getRecipeSink(): RecipeSink {
  return (g.__frRecipeSink ??= new RepositoryRecipeSink(getRecipeRepository()));
}
