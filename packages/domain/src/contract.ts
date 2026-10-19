/**
 * Final zod versions of the CONTRACT-SEED.ts shapes (names identical; L1 owns these).
 * Inferred TS types are structurally compatible with CONTRACT-SEED (see test/contract-compat.test.ts).
 */
import { z } from 'zod';
import {
  IngredientForm, IsoDate, IsoDateTime, NutrientKey, NutrientUnit, Pence, PriceKind, Quantity, Uuid, ValueStatus,
} from './primitives';

export const CanonicalIngredient = z.object({
  id: Uuid,
  name: z.string().min(1).max(120),
  category: z.string().min(1).max(60),
  aliases: z.array(z.string().min(1).max(120)),
  /** enables volume<->mass; engine refuses conversion without it */
  densityGPerMl: z.object({ value: z.number().positive(), source: z.string().min(1) }).optional(),
  /** e.g. 1 onion; always an estimate */
  unitWeightG: z.object({ value: z.number().positive(), source: z.string().min(1), estimate: z.literal(true) }).optional(),
  /** fresh vs ground coriander stay separate */
  form: IngredientForm.optional(),
});
export type CanonicalIngredient = z.infer<typeof CanonicalIngredient>;

export const RecipeIngredientLine = z.object({
  id: Uuid,
  recipeId: Uuid,
  /** undefined = unmatched; the line is kept */
  ingredientId: Uuid.optional(),
  quantity: Quantity,
  preparation: z.string().max(200).optional(),
  optional: z.boolean(),
  order: z.number().int().nonnegative(),
});
export type RecipeIngredientLine = z.infer<typeof RecipeIngredientLine>;

/** Provenance from a shopping requirement back to what contributed it. */
export const Contribution = z.object({
  recipeId: Uuid,
  plannedMealId: Uuid.optional(),
  recipeIngredientId: Uuid,
  quantity: Quantity,
});
export type Contribution = z.infer<typeof Contribution>;

export const Requirement = z.object({
  ingredientId: Uuid.optional(),
  displayName: z.string().min(1).max(200),
  /** combined where safely combinable */
  quantity: Quantity,
  contributions: z.array(Contribution),
  /** parts that could not be safely combined/converted */
  unresolved: z.array(Quantity).optional(),
});
export type Requirement = z.infer<typeof Requirement>;

/** Unknown is never zero: value present iff status is known/zero; zero => value 0. */
export const NutrientValue = z
  .object({
    nutrient: NutrientKey,
    status: ValueStatus,
    value: z.number().nonnegative().optional(),
    unit: NutrientUnit,
    source: z.string().optional(),
    estimate: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.status === 'known' && v.value === undefined) ctx.addIssue({ code: 'custom', message: 'known value needs value' });
    if (v.status === 'zero' && v.value !== undefined && v.value !== 0) ctx.addIssue({ code: 'custom', message: 'zero status must have value 0' });
    if ((v.status === 'unknown' || v.status === 'unavailable') && v.value !== undefined) {
      ctx.addIssue({ code: 'custom', message: `${v.status} must not carry a value (never present unknown as 0)` });
    }
  });
export type NutrientValue = z.infer<typeof NutrientValue>;

export const PriceObservation = z
  .object({
    ingredientId: Uuid.optional(),
    productPackId: Uuid.optional(),
    retailer: z.string().min(1).max(80).optional(),
    pricePence: Pence,
    packQuantity: Quantity,
    kind: PriceKind,
    observedOn: IsoDate,
    source: z.string().min(1).max(200),
  })
  .refine((p) => p.ingredientId !== undefined || p.productPackId !== undefined, {
    message: 'ingredientId or productPackId required',
  });
export type PriceObservation = z.infer<typeof PriceObservation>;

export const ProductPack = z.object({
  id: Uuid,
  name: z.string().min(1).max(200),
  ingredientId: Uuid,
  quantity: Quantity,
  retailer: z.string().min(1).max(80).optional(),
});
export type ProductPack = z.infer<typeof ProductPack>;

/** Append-only purchase event; client-generated id makes offline replay idempotent. */
export const PurchaseEvent = z.object({
  id: Uuid,
  shoppingListItemId: Uuid,
  quantity: Quantity,
  actualPricePence: Pence.optional(),
  receiptLineId: Uuid.optional(),
  createdBy: Uuid,
  createdAt: IsoDateTime,
  /** user who voided the event (one-time; voided events are excluded from purchased quantity) */
  voidedBy: Uuid.optional(),
});
export type PurchaseEvent = z.infer<typeof PurchaseEvent>;
