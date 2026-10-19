import { describe, expect, it } from 'vitest';
import {
  CanonicalIngredient, HouseholdExclusion, IngredientPriceRow, NutrientValue, PlannedMeal, PRICE_KIND_PRIORITY,
  PriceObservation, PurchaseCommandResult, PurchaseEvent, PurchaseEventRow, ReceiptParseLine, Quantity, RecipeIngredientRow, RecordPurchaseInput,
  Requirement, ShoppingListItemProgress, fromDbRow, quantityFromColumns, recordPurchaseArgs, toDbRow, unitDimension,
} from '../src/index';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const now = '2026-10-19T12:00:00.123456+00:00';

describe('Quantity', () => {
  it.each([
    { kind: 'exact', value: 200, unit: 'g', originalText: '200g flour' },
    { kind: 'range', min: 2, max: 3, unit: 'item', originalText: '2-3 onions' },
    { kind: 'approximate', approxLabel: 'pinch', originalText: 'a pinch of salt' },
    { kind: 'approximate', value: 1, approxLabel: 'handful', originalText: 'a handful of parsley' },
    { kind: 'to_taste', originalText: 'salt to taste' },
    { kind: 'unparsed', originalText: 'some cheese' },
  ])('accepts $originalText', (q) => {
    expect(Quantity.safeParse(q).success).toBe(true);
  });

  it.each([
    [{ kind: 'exact', unit: 'g', originalText: 'x' }, 'exact without value'],
    [{ kind: 'exact', value: 0, unit: 'g', originalText: 'x' }, 'exact zero'],
    [{ kind: 'exact', value: 1, min: 1, max: 2, originalText: 'x' }, 'exact with range'],
    [{ kind: 'range', min: 3, max: 2, originalText: 'x' }, 'min > max'],
    [{ kind: 'range', value: 2, min: 1, max: 2, originalText: 'x' }, 'range with value'],
    [{ kind: 'to_taste', value: 2, unit: 'g', originalText: 'x' }, 'invented weight for to_taste'],
    [{ kind: 'unparsed', unit: 'g', originalText: 'x' }, 'unparsed with unit'],
    [{ kind: 'approximate', originalText: 'x' }, 'approximate without approxLabel'],
    [{ kind: 'approximate', approxLabel: 'handful', unit: 'bunch', originalText: 'x' }, 'approximate with unit'],
    [{ kind: 'exact', value: 1, unit: 'gallon', originalText: 'x' }, 'unknown unit'],
    [{ kind: 'exact', value: 1, unit: 'g' }, 'missing originalText'],
  ] as [unknown, string][])('rejects %#: %s', (q) => {
    expect(Quantity.safeParse(q).success).toBe(false);
  });

  it('maps units to dimensions like SQL unit_dimension()', () => {
    expect(unitDimension('kg')).toBe('mass');
    expect(unitDimension('tbsp')).toBe('volume');
    expect(unitDimension('clove')).toBe('count');
  });
});

describe('contract shapes', () => {
  it('CanonicalIngredient requires unit weights to be flagged estimate', () => {
    const base = { id: id(1), name: 'Onion', category: 'Veg', aliases: ['brown onion'], form: 'fresh' as const };
    expect(CanonicalIngredient.safeParse({ ...base, unitWeightG: { value: 150, source: 'seed', estimate: true } }).success).toBe(true);
    expect(CanonicalIngredient.safeParse({ ...base, unitWeightG: { value: 150, source: 'seed', estimate: false } }).success).toBe(false);
  });

  it('Requirement keeps provenance and unresolved parts', () => {
    const r = Requirement.parse({
      ingredientId: id(2),
      displayName: 'Flour',
      quantity: { kind: 'exact', value: 200, unit: 'g', originalText: '200 g' },
      contributions: [{ recipeId: id(3), recipeIngredientId: id(4), quantity: { kind: 'exact', value: 200, unit: 'g', originalText: '200g flour' } }],
      unresolved: [{ kind: 'exact', value: 200, unit: 'ml', originalText: '200ml flour' }],
    });
    expect(r.unresolved).toHaveLength(1);
  });

  it('NutrientValue never presents unknown as zero', () => {
    expect(NutrientValue.safeParse({ nutrient: 'salt', status: 'unknown', unit: 'g', estimate: false }).success).toBe(true);
    expect(NutrientValue.safeParse({ nutrient: 'salt', status: 'unknown', value: 0, unit: 'g', estimate: false }).success).toBe(false);
    expect(NutrientValue.safeParse({ nutrient: 'salt', status: 'known', unit: 'g', estimate: false }).success).toBe(false);
    expect(NutrientValue.safeParse({ nutrient: 'salt', status: 'zero', value: 0, unit: 'g', estimate: false }).success).toBe(true);
  });

  it('money is integer pence', () => {
    const p = { ingredientId: id(1), pricePence: 150, packQuantity: { kind: 'exact', value: 1, unit: 'kg', originalText: '1kg' },
      kind: 'generic_estimate', observedOn: '2026-10-01', source: 'seed' };
    expect(PriceObservation.safeParse(p).success).toBe(true);
    expect(PriceObservation.safeParse({ ...p, pricePence: 1.5 }).success).toBe(false);
    expect(PriceObservation.safeParse({ ...p, pricePence: -1 }).success).toBe(false);
    expect(PriceObservation.safeParse({ ...p, ingredientId: undefined }).success).toBe(false);
  });

  it('price kind priority order', () => {
    expect(PRICE_KIND_PRIORITY).toEqual(['user_confirmed', 'receipt', 'retailer_verified', 'generic_estimate']);
  });

  it('PurchaseEvent', () => {
    expect(PurchaseEvent.safeParse({ id: id(1), shoppingListItemId: id(2), quantity: { kind: 'exact', value: 1, unit: 'item', originalText: 'tick' },
      createdBy: id(3), createdAt: now }).success).toBe(true);
  });
});

describe('entity rules mirror DB constraints', () => {
  it('household exclusion needs a matcher and consent for allergies', () => {
    const base = { id: id(1), householdId: id(2), ingredientId: null, allergenGroup: null, term: null, kind: 'avoid' as const,
      consentRecordedAt: null, createdBy: null, createdAt: now };
    expect(HouseholdExclusion.safeParse(base).success).toBe(false);
    expect(HouseholdExclusion.safeParse({ ...base, term: 'coriander' }).success).toBe(true);
    expect(HouseholdExclusion.safeParse({ ...base, allergenGroup: 'peanuts', kind: 'allergy' }).success).toBe(false);
    expect(HouseholdExclusion.safeParse({ ...base, allergenGroup: 'peanuts', kind: 'allergy', consentRecordedAt: now }).success).toBe(true);
  });

  it('planned meal recipe/kind consistency', () => {
    const base = { id: id(1), mealPlanId: id(2), householdId: id(3), mealDate: '2026-10-20', mealType: 'dinner' as const,
      servings: 4, approved: false, notes: null, position: 0, createdAt: now, updatedAt: now };
    expect(PlannedMeal.safeParse({ ...base, kind: 'recipe', recipeId: id(4) }).success).toBe(true);
    expect(PlannedMeal.safeParse({ ...base, kind: 'recipe', recipeId: null }).success).toBe(false);
    expect(PlannedMeal.safeParse({ ...base, kind: 'eating_out', recipeId: id(4) }).success).toBe(false);
    expect(PlannedMeal.safeParse({ ...base, kind: 'leftovers', recipeId: null }).success).toBe(true);
  });

  it('household prices cannot claim reference kinds', () => {
    const base = { id: id(1), householdId: id(2), ingredientId: id(3), productPackId: null, retailer: null, pricePence: 100,
      currency: 'GBP', quantity: { kind: 'exact', value: 1, unit: 'kg', originalText: '' }, observedOn: '2026-10-01',
      source: 'user', receiptLineId: null, createdBy: null, createdAt: now };
    expect(IngredientPriceRow.safeParse({ ...base, kind: 'user_confirmed' }).success).toBe(true);
    expect(IngredientPriceRow.safeParse({ ...base, kind: 'retailer_verified' }).success).toBe(false);
    expect(IngredientPriceRow.safeParse({ ...base, householdId: null, kind: 'generic_estimate' }).success).toBe(true);
  });
});

describe('db mapping', () => {
  const dbRow = {
    id: id(1), recipe_id: id(2), household_id: id(3), ingredient_id: null, original_text: 'a pinch of saffron',
    quantity_kind: 'approximate', quantity_value: null, quantity_min: null, quantity_max: null, unit: null, approx_label: 'pinch',
    preparation: null, group_label: null, optional: false, position: 1, created_at: now, updated_at: now,
  };

  it('folds flattened quantity columns', () => {
    const r = fromDbRow(RecipeIngredientRow, dbRow);
    expect(r.quantity).toEqual({ kind: 'approximate', approxLabel: 'pinch', originalText: 'a pinch of saffron' });
    expect(r.recipeId).toBe(id(2));
  });

  it('round-trips back to columns', () => {
    const r = fromDbRow(RecipeIngredientRow, dbRow);
    expect(toDbRow(r)).toEqual(dbRow);
  });

  it('coerces numeric strings', () => {
    expect(quantityFromColumns({ quantity_kind: 'exact', quantity_value: '1.500', unit: 'kg', original_text: '1.5kg' }).value).toBe(1.5);
  });

  it('progress view parses without folding', () => {
    const v = fromDbRow(ShoppingListItemProgress, {
      shopping_list_item_id: id(1), shopping_list_id: id(2), household_id: id(3), quantity_kind: 'exact', unit: 'item',
      required_quantity: 3, purchased_quantity: 2, outstanding_quantity: 1, purchase_event_count: 1, actual_spend_pence: 30,
      has_unit_mismatch: false, purchase_status: 'partial', last_purchased_at: now,
    }, { foldQuantity: false });
    expect(v.purchaseStatus).toBe('partial');
  });
});

describe('rpc', () => {
  it('record_purchase input rules and arg mapping', () => {
    expect(RecordPurchaseInput.safeParse({ eventId: id(1), itemId: id(2), mode: 'purchase' }).success).toBe(false);
    expect(RecordPurchaseInput.safeParse({ eventId: id(1), itemId: id(2), mode: 'tick', expectedOutstanding: 3 }).success).toBe(false);
    const i = RecordPurchaseInput.parse({ eventId: id(1), itemId: id(2), mode: 'tick', expectedOutstanding: 470, expectedEventCount: 1 });
    expect(recordPurchaseArgs(i)).toMatchObject({ p_mode: 'tick', p_qty: null, p_expected_outstanding: 470, p_expected_event_count: 1 });
  });

  it('parses SQL results', () => {
    expect(PurchaseCommandResult.parse({ status: 'rejected', reason: 'already_complete', completedBy: [id(9)] }).status).toBe('rejected');
    expect(PurchaseCommandResult.safeParse({ status: 'rejected', reason: 'nope' }).success).toBe(false);
  });
});

describe('owner decisions (2026-10-19)', () => {
  const base = {
    id: id(1), shoppingListItemId: id(2), householdId: id(3),
    quantity: { kind: 'exact', value: 1, unit: 'item', originalText: 'tick' },
    actualPricePence: null, receiptLineId: null, createdAt: now, voidedBy: null, voidedAt: null,
  };
  it('PurchaseEventRow allows a deleted-account actor but keeps the display-name snapshot', () => {
    expect(PurchaseEventRow.safeParse({ ...base, createdBy: null, createdByDisplayName: 'Carol' }).success).toBe(true);
    expect(PurchaseEventRow.safeParse({ ...base, createdBy: id(9), createdByDisplayName: null }).success).toBe(true);
  });
  it('contract PurchaseEvent still requires createdBy for new events', () => {
    const ev = { id: id(1), shoppingListItemId: id(2), quantity: base.quantity, createdAt: now };
    expect(PurchaseEvent.safeParse(ev).success).toBe(false);
    expect(PurchaseEvent.safeParse({ ...ev, createdBy: id(9) }).success).toBe(true);
  });
  it('ReceiptParseLine: discounts are positive saved pence', () => {
    expect(ReceiptParseLine.parse({ rawText: 'CHEESE', pricePence: 250 }).discountPence).toBe(0);
    expect(ReceiptParseLine.safeParse({ rawText: 'CHEESE', pricePence: 250, discountPence: -50 }).success).toBe(false);
  });
});
