/**
 * Primitive shapes and enums. Names and literal values mirror CONTRACT-SEED.ts and the Postgres enums in
 * migrations/0001_foundation.sql exactly — change both together.
 */
import { z } from 'zod';

export const Uuid = z.uuid();
export type Uuid = z.infer<typeof Uuid>;
/** YYYY-MM-DD */
export const IsoDate = z.iso.date();
export type IsoDate = z.infer<typeof IsoDate>;
export const IsoDateTime = z.iso.datetime({ offset: true });
export type IsoDateTime = z.infer<typeof IsoDateTime>;

/** Money is ALWAYS integer pence. Never floats for money. */
export const Pence = z.number().int().nonnegative();
export type Pence = z.infer<typeof Pence>;
/** Signed pence (receipt discount lines). */
export const SignedPence = z.number().int();

export const MASS_UNITS = ['mg', 'g', 'kg'] as const;
export const VOLUME_UNITS = ['ml', 'l', 'tsp', 'tbsp', 'cup', 'floz', 'pint'] as const;
export const COUNT_UNITS = ['item', 'clove', 'slice', 'can', 'pack', 'bunch', 'sprig', 'stick'] as const;

export const MassUnit = z.enum(MASS_UNITS);
export type MassUnit = z.infer<typeof MassUnit>;
export const VolumeUnit = z.enum(VOLUME_UNITS);
export type VolumeUnit = z.infer<typeof VolumeUnit>;
export const CountUnit = z.enum(COUNT_UNITS);
export type CountUnit = z.infer<typeof CountUnit>;
export const Unit = z.enum([...MASS_UNITS, ...VOLUME_UNITS, ...COUNT_UNITS]);
export type Unit = z.infer<typeof Unit>;
export const Dimension = z.enum(['mass', 'volume', 'count']);
export type Dimension = z.infer<typeof Dimension>;

/** Mirrors SQL public.unit_dimension(). */
export function unitDimension(u: Unit): Dimension {
  if ((MASS_UNITS as readonly string[]).includes(u)) return 'mass';
  if ((VOLUME_UNITS as readonly string[]).includes(u)) return 'volume';
  return 'count';
}

export const QuantityKind = z.enum(['exact', 'range', 'approximate', 'to_taste', 'unparsed']);
export type QuantityKind = z.infer<typeof QuantityKind>;

/**
 * CONTRACT Quantity. Shape rules follow SQL public.quantity_is_valid(), plus ratified L6 extras for approximate:
 *   exact       value > 0, no min/max
 *   range       0 <= min <= max, no value
 *   approximate approxLabel required (e.g. 'pinch'), optional value > 0, no min/max, NO unit (never converted to a weight;
 *               ratified 2026-10-19: L6 strictness — SQL quantity_is_valid() is looser, zod is the stricter gate)
 *   to_taste    no value/min/max/unit
 *   unparsed    no value/min/max/unit (originalText is the only truth)
 */
export const Quantity = z
  .object({
    kind: QuantityKind,
    value: z.number().finite().optional(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    unit: Unit.optional(),
    approxLabel: z.string().max(40).optional(),
    originalText: z.string(),
  })
  .superRefine((q, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    const noRange = q.min === undefined && q.max === undefined;
    switch (q.kind) {
      case 'exact':
        if (q.value === undefined || q.value <= 0) issue('exact quantity needs value > 0');
        if (!noRange) issue('exact quantity must not have min/max');
        break;
      case 'range':
        if (q.value !== undefined) issue('range quantity must not have value');
        if (q.min === undefined || q.max === undefined) issue('range quantity needs min and max');
        else if (q.min < 0 || q.min > q.max) issue('range quantity needs 0 <= min <= max');
        break;
      case 'approximate':
        if (!q.approxLabel) issue('approximate quantity needs approxLabel');
        if (q.unit !== undefined) issue('approximate quantity must not carry a convertible unit');
        if (q.value !== undefined && q.value <= 0) issue('approximate value must be > 0');
        if (!noRange) issue('approximate quantity must not have min/max');
        break;
      case 'to_taste':
      case 'unparsed':
        if (q.value !== undefined || !noRange || q.unit !== undefined) {
          issue(`${q.kind} quantity must not carry value/min/max/unit`);
        }
        break;
    }
  });
export type Quantity = z.infer<typeof Quantity>;

export const ValueStatus = z.enum(['known', 'zero', 'unknown', 'unavailable']);
export type ValueStatus = z.infer<typeof ValueStatus>;
export const NutrientKey = z.enum([
  'energy_kcal', 'energy_kj', 'protein', 'carbohydrate', 'sugars', 'fat', 'saturates', 'fibre', 'salt', 'sodium',
]);
export type NutrientKey = z.infer<typeof NutrientKey>;
export const NutrientUnit = z.enum(['kcal', 'kJ', 'g', 'mg', 'ug']);
export type NutrientUnit = z.infer<typeof NutrientUnit>;

/** Priority order: user_confirmed > receipt > retailer_verified > generic_estimate. */
export const PriceKind = z.enum(['user_confirmed', 'receipt', 'retailer_verified', 'generic_estimate']);
export type PriceKind = z.infer<typeof PriceKind>;
export const PRICE_KIND_PRIORITY: readonly PriceKind[] = PriceKind.options;

export const MealType = z.enum(['breakfast', 'lunch', 'dinner', 'snack']);
export type MealType = z.infer<typeof MealType>;
export const DietCategory = z.enum(['meat', 'fish', 'vegetarian', 'vegan']);
export type DietCategory = z.infer<typeof DietCategory>;
export const IngredientForm = z.enum(['fresh', 'dried', 'ground', 'frozen', 'canned', 'other']);
export type IngredientForm = z.infer<typeof IngredientForm>;

// ---- schema-only enums (not in CONTRACT-SEED) ----
export const HouseholdRole = z.enum(['owner', 'member']);
export type HouseholdRole = z.infer<typeof HouseholdRole>;
export const MembershipStatus = z.enum(['active', 'revoked', 'left']);
export type MembershipStatus = z.infer<typeof MembershipStatus>;
export const HouseholdStatus = z.enum(['active', 'pending_deletion']);
export type HouseholdStatus = z.infer<typeof HouseholdStatus>;
export const PreferredUnits = z.enum(['metric', 'imperial', 'us']);
export type PreferredUnits = z.infer<typeof PreferredUnits>;
export const ExclusionKind = z.enum(['allergy', 'intolerance', 'avoid']);
export type ExclusionKind = z.infer<typeof ExclusionKind>;
/** UK FIC 14 regulated allergens. */
export const AllergenGroup = z.enum([
  'celery', 'cereals_gluten', 'crustaceans', 'eggs', 'fish', 'lupin', 'milk', 'molluscs',
  'mustard', 'peanuts', 'sesame', 'soya', 'sulphites', 'tree_nuts',
]);
export type AllergenGroup = z.infer<typeof AllergenGroup>;
export const ConsentType = z.enum(['allergy_data', 'dietary_restrictions']);
export type ConsentType = z.infer<typeof ConsentType>;
export const RecipeStatus = z.enum(['draft', 'active', 'archived']);
export type RecipeStatus = z.infer<typeof RecipeStatus>;
export const RecipeImageKind = z.enum(['source', 'cover']);
export type RecipeImageKind = z.infer<typeof RecipeImageKind>;
export const ImageMimeType = z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/heic']);
export type ImageMimeType = z.infer<typeof ImageMimeType>;
export const MealPlanStatus = z.enum(['draft', 'approved', 'archived']);
export type MealPlanStatus = z.infer<typeof MealPlanStatus>;
export const PlannedMealKind = z.enum(['recipe', 'leftovers', 'eating_out', 'other']);
export type PlannedMealKind = z.infer<typeof PlannedMealKind>;
export const ShoppingListStatus = z.enum(['active', 'completed', 'archived']);
export type ShoppingListStatus = z.infer<typeof ShoppingListStatus>;
export const ShoppingItemStatus = z.enum(['active', 'removed']);
export type ShoppingItemStatus = z.infer<typeof ShoppingItemStatus>;
export const PurchaseStatus = z.enum(['outstanding', 'partial', 'purchased']);
export type PurchaseStatus = z.infer<typeof PurchaseStatus>;
export const ReceiptStatus = z.enum(['uploaded', 'parsed', 'reconciling', 'reconciled', 'failed']);
export type ReceiptStatus = z.infer<typeof ReceiptStatus>;
export const ReceiptLineMatchStatus = z.enum(['unmatched', 'suggested', 'confirmed', 'extra', 'ignored']);
export type ReceiptLineMatchStatus = z.infer<typeof ReceiptLineMatchStatus>;
/** 'correction' and 'leftover' are written by the pantry engine (D147). */
export const PantrySource = z.enum(['manual', 'purchase', 'receipt', 'correction', 'leftover']);
export type PantrySource = z.infer<typeof PantrySource>;
export const NutritionBasis = z.enum(['total', 'per_serving']);
export type NutritionBasis = z.infer<typeof NutritionBasis>;
export const AiOperation = z.enum([
  'recipe_extraction', 'receipt_parse', 'tagging', 'meal_plan', 'ingredient_match', 'substitution',
]);
export type AiOperation = z.infer<typeof AiOperation>;
export const AiStatus = z.enum(['success', 'error', 'invalid_output', 'rate_limited', 'rejected']);
export type AiStatus = z.infer<typeof AiStatus>;
export const StorageBucket = z.enum(['recipe-images', 'receipt-images']);
export type StorageBucket = z.infer<typeof StorageBucket>;
export const DeletionSubject = z.enum(['household', 'member']);
export type DeletionSubject = z.infer<typeof DeletionSubject>;
export const ShoppingCommandType = z.enum(['tick', 'purchase', 'void', 'regenerate', 'add', 'edit', 'remove']);
export type ShoppingCommandType = z.infer<typeof ShoppingCommandType>;
