// QA-side fixture contract. Shared shapes come from @fr/domain (single source of truth, merge batch 3);
// only the QA-owned fixture shapes (expected extraction, receipt acceptance lines, household seed) live here.
import { z } from 'zod';
import {
  DietCategory,
  IsoDate,
  IsoDateTime,
  MealType,
  Pence as DomainPence,
  PriceKind,
  PurchaseEvent,
  Quantity as DomainQuantity,
  QuantityKind,
  RecipeIngredientLine,
  SignedPence,
  Unit,
  Uuid,
  type ReceiptParseLine,
} from '@fr/domain';

export { DietCategory, IsoDate, IsoDateTime, MealType, PriceKind, PurchaseEvent, QuantityKind, RecipeIngredientLine, Unit, Uuid };

/** Non-negative integer pence (domain). Signed lines use `SignedPence` below. */
export const Pence = DomainPence;

/**
 * Domain Quantity (ratified: approximate => approxLabel + no unit; to_taste/unparsed carry no value/unit) with the
 * extra QA rule that originalText is never empty in fixtures.
 */
export const Quantity = DomainQuantity.refine((q) => q.originalText.length > 0, { message: 'originalText must be non-empty' });

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
  /** ratified: servings is a positive integer everywhere */
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
/** QA acceptance line: carries expected-* fields, so it stays QA-only. Discount lines are NEGATIVE on this side. */
export const ReceiptLine = z.object({
  id: Uuid,
  rawText: z.string(),
  kind: ReceiptLineKind,
  quantity: z.number().int().positive().default(1),
  linePricePence: SignedPence, // negative for discounts
  expectedIngredient: z.string().nullable(), // null = must NOT match any recipe ingredient
  expectedPack: Quantity.optional(),
});
export type QaReceiptLine = z.infer<typeof ReceiptLine>;
export const ReceiptFixture = z.object({
  image: z.string(),
  retailer: z.string(),
  date: IsoDate,
  lines: z.array(ReceiptLine).min(1),
  totalPence: Pence,
  note: z.string(),
});
export type QaReceiptFixture = z.infer<typeof ReceiptFixture>;

/**
 * Map QA fixture lines onto the ratified canonical wire shape (`ReceiptParseLine` in @fr/domain):
 *   rawText -> rawText, quantity -> quantity, linePricePence -> pricePence,
 *   negative discount lines -> positive `discountPence` on the PREVIOUS item line (orphan discounts are dropped
 *   from the output and reported via `orphanDiscountPence`).
 */
export function toCanonicalReceiptLines(lines: readonly QaReceiptLine[]): {
  lines: ReceiptParseLine[];
  orphanDiscountPence: number;
} {
  const out: ReceiptParseLine[] = [];
  let orphan = 0;
  for (const l of lines) {
    if (l.kind === 'item') {
      out.push({ rawText: l.rawText, quantity: l.quantity, pricePence: l.linePricePence, discountPence: 0 });
    } else {
      const saved = Math.abs(l.linePricePence);
      const prev = out[out.length - 1];
      if (prev) prev.discountPence += saved;
      else orphan += saved;
    }
  }
  return { lines: out, orphanDiscountPence: orphan };
}

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
