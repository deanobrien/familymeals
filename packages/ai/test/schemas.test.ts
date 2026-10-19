import { describe, expect, it } from 'vitest';
import recipeFx from '../fixtures/recipe-extraction.json' with { type: 'json' };
import receiptFx from '../fixtures/receipt-parse.json' with { type: 'json' };
import tagFx from '../fixtures/tag-suggestion.json' with { type: 'json' };
import planFx from '../fixtures/plan-constraints.json' with { type: 'json' };
import subsFx from '../fixtures/substitutions.json' with { type: 'json' };
import {
  PlanConstraintsSchema, QuantitySchema, ReceiptParseSchema, RecipeExtractionSchema, SubstitutionSchema, TagSuggestionSchema,
} from '../src/index.js';

describe('schemas', () => {
  it('accepts all fixtures', () => {
    expect(RecipeExtractionSchema.safeParse(recipeFx).success).toBe(true);
    expect(ReceiptParseSchema.safeParse(receiptFx).success).toBe(true);
    expect(TagSuggestionSchema.safeParse(tagFx).success).toBe(true);
    expect(PlanConstraintsSchema.safeParse(planFx).success).toBe(true);
    expect(SubstitutionSchema.safeParse(subsFx).success).toBe(true);
  });

  it('rejects bad quantities', () => {
    expect(QuantitySchema.safeParse({ kind: 'exact', originalText: '2' }).success).toBe(false);
    expect(QuantitySchema.safeParse({ kind: 'range', min: 5, max: 2, originalText: '5-2' }).success).toBe(false);
    expect(QuantitySchema.safeParse({ kind: 'exact', value: 1, unit: 'oz', originalText: '1oz' }).success).toBe(false);
    expect(QuantitySchema.safeParse({ kind: 'to_taste', originalText: 'to taste' }).success).toBe(true);
  });

  it('rejects recipe with no ingredients or fractional pence', () => {
    expect(RecipeExtractionSchema.safeParse({ ...recipeFx, ingredients: [] }).success).toBe(false);
    expect(ReceiptParseSchema.safeParse({ lines: [{ text: 'x', pricePence: 1.5 }] }).success).toBe(false);
  });

  it('plan constraints default hard-exclusion list and validate ranges', () => {
    const p = PlanConstraintsSchema.parse({ days: 3, mealTypes: ['dinner'] });
    expect(p.excludeIngredients).toEqual([]);
    expect(PlanConstraintsSchema.safeParse({ days: 0, mealTypes: ['dinner'] }).success).toBe(false);
    expect(PlanConstraintsSchema.safeParse({ days: 3, mealTypes: ['dinner'], dietProportions: { meat: 2 } }).success).toBe(false);
  });
});
