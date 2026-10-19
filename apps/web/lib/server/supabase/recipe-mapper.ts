// recipe view document (SQL recipe_view_json, row-shaped snake_case jsonb) -> web RecipeView, via the @fr/domain row schemas.
import {
  NutritionProfileValue,
  Quantity,
  Recipe,
  RecipeIngredientRow,
  RecipeStep,
  fromDbRow,
  quantityFromColumns,
  type DbRow,
} from '@fr/domain';
import type { RecipeInput } from '../../recipes/schema';
import type { IngredientLine, NutrientValue, RecipeView } from '../../recipes/types';
import { toIso } from './rpc';

const arr = (v: unknown): DbRow[] => (Array.isArray(v) ? (v as DbRow[]) : []);

/** Quantity from flattened columns; a row another writer left outside the strict rules degrades to "unparsed", never throws. */
export function safeQuantity(row: DbRow) {
  const parsed = Quantity.safeParse(quantityFromColumns(row));
  return parsed.success ? parsed.data : ({ kind: 'unparsed', originalText: String(row.original_text ?? '') } as const);
}

function ingredientLine(row: DbRow): IngredientLine {
  const quantity = safeQuantity(row);
  let ingredientId: string | undefined;
  let preparation: string | undefined;
  let id = String(row.id);
  let order = Number(row.position ?? 0);
  let optional = Boolean(row.optional);
  try {
    const parsed = fromDbRow(RecipeIngredientRow, row);
    id = parsed.id;
    order = parsed.position;
    optional = parsed.optional;
    ingredientId = parsed.ingredientId ?? undefined;
    preparation = parsed.preparation ?? undefined;
  } catch {
    ingredientId = row.ingredient_id ? String(row.ingredient_id) : undefined;
    preparation = row.preparation ? String(row.preparation) : undefined;
  }
  return {
    id,
    // display_name carries the name as written; rows from other writers fall back to their line text
    name: String(row.display_name ?? row.original_text ?? ''),
    ingredientId,
    quantity,
    preparation,
    optional,
    order,
  };
}

function nutrition(doc: unknown): NutrientValue[] {
  const values = arr((doc as { values?: unknown } | null)?.values);
  return values.map((v) => {
    const row = fromDbRow(NutritionProfileValue, v, { foldQuantity: false });
    return {
      nutrient: row.nutrient,
      status: row.valueStatus,
      ...(row.value !== null ? { value: row.value } : {}),
      unit: row.unit,
      ...(row.source ? { source: row.source } : {}),
      estimate: row.estimate,
    };
  });
}

/** Cost is not persisted yet (no cost cache in schema v1): recipes always report an unknown cost, never 0. */
export function recipeViewFromDoc(doc: DbRow): RecipeView {
  const r = fromDbRow(Recipe, doc);
  const steps = arr(doc.steps).map((s) => fromDbRow(RecipeStep, s, { foldQuantity: false }));
  const ratingRaw = doc.rating;
  return {
    id: r.id,
    title: r.title,
    description: r.description ?? '',
    imageUrl: typeof doc.image_url === 'string' ? doc.image_url : null,
    sourceAttribution: r.sourceAttribution ?? '',
    sourceUrl: r.sourceUrl ?? '',
    originalText: typeof doc.original_text === 'string' ? doc.original_text : '',
    prepMinutes: r.prepMinutes,
    cookMinutes: r.cookMinutes,
    servings: r.defaultServings,
    cuisine: r.cuisine ?? '',
    // Rows written elsewhere may lack these; 'meat' is the no-claim default for diet (never assume vegetarian).
    mealType: r.mealType ?? 'dinner',
    diet: r.dietCategory ?? 'meat',
    tags: Array.isArray(doc.tags) ? (doc.tags as unknown[]).map(String) : [],
    ingredients: arr(doc.ingredients).map(ingredientLine),
    steps: steps.map((s) => ({ id: s.id, order: s.stepNumber - 1, text: s.instructions })),
    favourite: doc.favourite === true,
    rating: ratingRaw === null || ratingRaw === undefined ? null : Number(ratingRaw),
    cost: { totalPence: null, kind: 'generic_estimate' },
    nutritionPerServing: nutrition(doc.nutrition),
    createdAt: toIso(r.createdAt),
    updatedAt: toIso(r.updatedAt),
  };
}

/** RecipeView -> RecipeInput (used by duplicate). Canonical ingredient ids are kept. */
export function recipeInputFromView(r: RecipeView, overrides: Partial<RecipeInput> = {}): RecipeInput {
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
    ingredients: r.ingredients.map((i) => ({
      name: i.name,
      ingredientId: i.ingredientId,
      quantity: structuredClone(i.quantity),
      preparation: i.preparation,
      optional: i.optional,
    })),
    steps: r.steps.map((s) => s.text),
    ...overrides,
  };
}
