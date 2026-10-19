import type { PrintedNutrition, Quantity, QuantityKind, RecipeExtraction, Unit } from './extraction.js';
import type { RecipeDraft } from './types.js';

export interface RecipePayload {
  id: string; title: string; description?: string; servings?: number; prepMinutes?: number; cookMinutes?: number;
  tags: string[]; cuisine?: string; source?: string;
  sourcePublisher?: string; sourceReference?: string;
  /** As printed on the card (source-provided, never calculated). */
  printedNutrition?: PrintedNutrition & { source: 'recipe card'; calculated: false };
  printedAllergens?: string[];
  /** Stored cover image reference (front of the card). */
  imageRef?: string;
}
export interface RecipeIngredientPayload {
  id: string; recipeId: string; ingredientId?: string; order: number;
  /** Always preserved from the photo. */
  originalText: string; name: string; preparation?: string; optional: boolean;
  /** Card expects the cook to already have it ("You need: ..."). */
  pantryStaple?: boolean;
  quantity: Quantity;
  quantityKind: QuantityKind; quantityValue?: number; quantityMin?: number; quantityMax?: number;
  unit?: Unit; approxLabel?: string;
}
export interface RecipeStepPayload { id: string; recipeId: string; order: number; text: string; }
type CorrectedIngredient = RecipeExtraction['ingredients'][number] & { ingredientId?: string };
/** Corrected JSON mirrors the extraction shape so original vs corrected can be diffed. */
export interface RecipeVersionPayload {
  recipeId: string;
  original: RecipeDraft['original'];
  corrected: Omit<RecipeExtraction, 'ingredients'> & { ingredients: CorrectedIngredient[] };
  sourceImageRefs: string[];
  extractedAt: string;
}
export interface FinalisedRecipe {
  recipe: RecipePayload; ingredients: RecipeIngredientPayload[]; steps: RecipeStepPayload[]; version: RecipeVersionPayload;
}

export class DraftNotReadyError extends Error {
  constructor(public readonly blockingIssues: RecipeDraft['issues']) {
    super(`Draft has ${blockingIssues.length} blocking issue(s): ${blockingIssues.map((i) => i.message).join(' | ')}`);
  }
}

export function finaliseDraft(draft: RecipeDraft, opts: { newId?: () => string } = {}): FinalisedRecipe {
  const blocking = draft.issues.filter((i) => i.blocking);
  if (blocking.length) throw new DraftNotReadyError(blocking);
  const newId = opts.newId ?? (() => globalThis.crypto.randomUUID());
  const recipeId = newId();

  const recipe: RecipePayload = { id: recipeId, title: draft.title.value, tags: [...draft.tags] };
  if (draft.description !== undefined) recipe.description = draft.description;
  if (draft.servings.value !== undefined) recipe.servings = draft.servings.value;
  if (draft.prepMinutes !== undefined) recipe.prepMinutes = draft.prepMinutes;
  if (draft.cookMinutes !== undefined) recipe.cookMinutes = draft.cookMinutes;
  if (draft.cuisine !== undefined) recipe.cuisine = draft.cuisine;
  if (draft.source !== undefined) recipe.source = draft.source;
  if (draft.sourcePublisher !== undefined) recipe.sourcePublisher = draft.sourcePublisher;
  if (draft.sourceReference !== undefined) recipe.sourceReference = draft.sourceReference;
  if (draft.printedNutrition !== undefined) recipe.printedNutrition = structuredClone(draft.printedNutrition);
  if (draft.printedAllergens !== undefined) recipe.printedAllergens = [...draft.printedAllergens];
  if (draft.coverImageRef !== undefined) recipe.imageRef = draft.coverImageRef;

  const ingredients = draft.ingredients.map((i, order): RecipeIngredientPayload => {
    const q = i.quantity.value;
    const p: RecipeIngredientPayload = {
      id: newId(), recipeId, order, originalText: i.originalText, name: i.name.value,
      optional: i.optional, quantity: q, quantityKind: q.kind,
    };
    if (i.ingredientId.value !== undefined) p.ingredientId = i.ingredientId.value;
    if (i.preparation !== undefined) p.preparation = i.preparation;
    if (i.pantryStaple) p.pantryStaple = true;
    if (q.value !== undefined) p.quantityValue = q.value;
    if (q.min !== undefined) p.quantityMin = q.min;
    if (q.max !== undefined) p.quantityMax = q.max;
    if (q.unit !== undefined) p.unit = q.unit;
    if (q.approxLabel !== undefined) p.approxLabel = q.approxLabel;
    return p;
  });
  const steps = draft.steps.map((s, order): RecipeStepPayload => ({ id: newId(), recipeId, order, text: s.text }));

  const corrected: RecipeVersionPayload['corrected'] = {
    title: recipe.title,
    ingredients: draft.ingredients.map((i) => {
      const e: CorrectedIngredient = {
        originalText: i.originalText, name: i.name.value, quantity: i.quantity.value, optional: i.optional, confidence: i.confidence,
      };
      if (i.preparation !== undefined) e.preparation = i.preparation;
      if (i.pantryStaple) e.pantryStaple = true;
      if (i.ingredientId.value !== undefined) e.ingredientId = i.ingredientId.value;
      return e;
    }),
    steps: draft.steps.map((s) => s.text),
    tags: [...draft.tags], warnings: [...draft.warnings], confidence: {},
  };
  if (recipe.description !== undefined) corrected.description = recipe.description;
  if (recipe.servings !== undefined) corrected.servings = recipe.servings;
  if (recipe.prepMinutes !== undefined) corrected.prepMinutes = recipe.prepMinutes;
  if (recipe.cookMinutes !== undefined) corrected.cookMinutes = recipe.cookMinutes;
  if (recipe.cuisine !== undefined) corrected.cuisine = recipe.cuisine;
  if (recipe.printedNutrition !== undefined) corrected.printedNutrition = { basis: recipe.printedNutrition.basis, values: recipe.printedNutrition.values, ...(recipe.printedNutrition.note ? { note: recipe.printedNutrition.note } : {}) };
  if (recipe.printedAllergens !== undefined) corrected.printedAllergens = [...recipe.printedAllergens];
  if (recipe.sourcePublisher !== undefined) corrected.sourcePublisher = recipe.sourcePublisher;
  if (recipe.sourceReference !== undefined) corrected.sourceReference = recipe.sourceReference;

  return {
    recipe, ingredients, steps,
    version: { recipeId, original: draft.original, corrected, sourceImageRefs: [...draft.sourceImageRefs], extractedAt: draft.extractedAt },
  };
}
