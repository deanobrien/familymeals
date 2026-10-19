// zod mirror of ../CONTRACT-SEED.ts (QA-side validation only; L1 owns the real versions).
import { z } from 'zod';

export const Uuid = z.string().uuid();
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const IsoDateTime = z.string().datetime();
export const Pence = z.number().int();

export const Unit = z.enum([
  'mg', 'g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'floz', 'pint',
  'item', 'clove', 'slice', 'can', 'pack', 'bunch', 'sprig', 'stick',
]);
export const QuantityKind = z.enum(['exact', 'range', 'approximate', 'to_taste', 'unparsed']);

export const Quantity = z
  .object({
    kind: QuantityKind,
    value: z.number().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    unit: Unit.optional(),
    approxLabel: z.string().optional(),
    originalText: z.string().min(1),
  })
  .superRefine((q, ctx) => {
    const bad = (m: string) => ctx.addIssue({ code: 'custom', message: m });
    if (q.kind === 'exact' && q.value === undefined) bad('exact needs value');
    if (q.kind === 'range') {
      if (q.min === undefined || q.max === undefined) bad('range needs min+max');
      else if (q.min > q.max) bad('min > max');
    }
    if (q.kind === 'approximate' && !q.approxLabel) bad('approximate needs approxLabel');
    if (q.kind === 'approximate' && q.unit) bad('approximate must not carry a convertible unit');
    if (q.kind === 'to_taste' && (q.value !== undefined || q.unit)) bad('to_taste has no value/unit');
  });

export const MealType = z.enum(['breakfast', 'lunch', 'dinner', 'snack']);
export const DietCategory = z.enum(['meat', 'fish', 'vegetarian', 'vegan']);

export const RecipeIngredientLine = z.object({
  id: Uuid, recipeId: Uuid, ingredientId: Uuid.optional(),
  quantity: Quantity, preparation: z.string().optional(),
  optional: z.boolean(), order: z.number().int().nonnegative(),
});

export const PriceKind = z.enum(['user_confirmed', 'receipt', 'retailer_verified', 'generic_estimate']);
export const PurchaseEvent = z.object({
  id: Uuid, shoppingListItemId: Uuid, quantity: Quantity,
  actualPricePence: Pence.optional(), receiptLineId: Uuid.optional(),
  createdBy: Uuid, createdAt: IsoDateTime, voidedBy: Uuid.optional(),
});

// ---- QA-owned fixture shapes (PROPOSED extraction/receipt output; L4/L13/L21 should align) ----

/** One extracted ingredient line (pre-persistence: no ids). `name` is the free-text ingredient. */
export const ExtractedIngredient = z.object({
  name: z.string().min(1),
  quantity: Quantity,
  preparation: z.string().optional(),
  optional: z.boolean().default(false),
});
export const ExtractedRecipe = z.object({
  title: z.string().min(1),
  servings: z.number().int().positive().optional(),
  ingredients: z.array(ExtractedIngredient).min(1),
  steps: z.array(z.string().min(1)).min(1),
});
/** Expected-extraction fixture: what a good model should return for the paired image. */
export const RecipeFixture = z.object({
  image: z.string(), // file name(s) relative to fixtures/recipes
  extraPages: z.array(z.string()).default([]),
  scenario: z.string(),
  expectedConfidence: z.enum(['high', 'low']),
  diet: DietCategory,
  expected: ExtractedRecipe,
});

export const ReceiptLineKind = z.enum(['item', 'multibuy_discount', 'promo_discount']);
export const ReceiptLine = z.object({
  id: Uuid,
  rawText: z.string(),
  kind: ReceiptLineKind,
  quantity: z.number().int().positive().default(1),
  linePricePence: Pence, // negative for discounts
  expectedIngredient: z.string().nullable(), // null = must NOT match any recipe ingredient
  expectedPack: Quantity.optional(),
});
export const ReceiptFixture = z.object({
  image: z.string(),
  retailer: z.string(),
  date: IsoDate,
  lines: z.array(ReceiptLine).min(1),
  totalPence: Pence,
  note: z.string(),
});

export const HouseholdSeed = z.object({
  household: z.object({ id: Uuid, name: z.string() }),
  members: z.array(z.object({ userId: Uuid, email: z.string().email(), displayName: z.string(), role: z.enum(['owner', 'member']) })),
  recipes: z.array(z.object({ id: Uuid, householdId: Uuid, title: z.string(), diet: DietCategory, servings: z.number().int(), createdBy: Uuid })),
  recipeIngredients: z.array(RecipeIngredientLine.extend({ name: z.string() })),
  mealPlan: z.object({
    id: Uuid, householdId: Uuid, weekStart: IsoDate, approved: z.boolean(),
    meals: z.array(z.object({ id: Uuid, recipeId: Uuid, date: IsoDate, mealType: MealType, servings: z.number().int() })),
  }),
  shoppingList: z.object({
    id: Uuid, householdId: Uuid, planId: Uuid,
    items: z.array(z.object({ id: Uuid, displayName: z.string(), quantity: Quantity, aisle: z.string(), manual: z.boolean() })),
  }),
});
