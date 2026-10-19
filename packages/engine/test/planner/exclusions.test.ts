import { describe, expect, it } from 'vitest';
import { hardCheck, PlanConstraintsSchema, solvePlan, termMatches, validatePlan, type PlanConstraintsInput } from '../../src/planner/index';
import { RecipeCandidateSchema } from '../../src/planner/schemas';
import { recipe } from './fixtures';

const base: PlanConstraintsInput = { startDate: '2026-10-19', days: 1, servings: 2 };
const codes = (k: Partial<PlanConstraintsInput>, r: Parameters<typeof recipe>[0]) =>
  hardCheck(RecipeCandidateSchema.parse(recipe(r)), PlanConstraintsSchema.parse({ ...base, ...k })).map((x) => x.code);

describe('exclusion matching: canonical ids first', () => {
  it('excludes by canonical ingredient id', () => {
    expect(codes({ excludeIngredientIds: ['ing-mush'] }, { id: 'a', dietCategory: 'vegan', ingredientIds: ['ing-rice', 'ing-mush'] })).toEqual(['excluded_ingredient']);
  });

  it('expands allergen groups to ingredient ids (case-insensitive group key)', () => {
    const k = { excludeAllergens: ['NUTS'], allergenGroups: { nuts: ['ing-almond', 'ing-cashew'] } };
    expect(codes(k, { id: 'a', dietCategory: 'vegan', ingredientIds: ['ing-cashew'] })).toEqual(['allergen']);
    expect(codes(k, { id: 'b', dietCategory: 'vegan', ingredientIds: ['ing-rice'] })).toEqual([]);
  });

  it('still honours allergens declared on the recipe summary', () => {
    expect(codes({ excludeAllergens: ['sesame'] }, { id: 'a', dietCategory: 'vegan', allergens: ['Sesame'] })).toEqual(['allergen']);
  });
});

describe('exclusion matching: secondary term safety net', () => {
  it('matches ingredient names/aliases case-insensitively, incl. naive singular', () => {
    expect(termMatches('Chestnut Mushroom', 'mushrooms')).toBe(true);
    expect(termMatches('raspberry', 'raspberries')).toBe(true);
    expect(termMatches('rice', 'mushroom')).toBe(false);
    // Catches a mis-mapped ingredient id the primary check would miss.
    expect(codes({ excludeTerms: ['Mushrooms'] }, { id: 'a', dietCategory: 'vegan', ingredientIds: ['ing-x'], ingredientNames: ['Shiitake mushroom', 'shiitake'] })).toEqual(['excluded_term']);
  });

  it('uses allergen names as terms too', () => {
    expect(codes({ excludeAllergens: ['peanuts'] }, { id: 'a', dietCategory: 'vegan', ingredientNames: ['Peanut butter'] })).toEqual(['excluded_term']);
  });

  it('FAIL SAFE: an unmatched line mentioning an excluded term violates, even with allowUnverifiedIngredients', () => {
    const r = { id: 'a', dietCategory: 'vegan' as const, unmatchedLines: ['2 handfuls of Mushrooms, sliced'] };
    expect(codes({ excludeTerms: ['mushroom'], allowUnverifiedIngredients: true }, r)).toEqual(['unmatched_line_term']);
    expect(codes({ excludeTerms: ['mushroom'] }, r)).toEqual(['unmatched_line_term']);
    expect(codes({ excludeAllergens: ['nuts'], allowUnverifiedIngredients: true }, { id: 'b', dietCategory: 'vegan', unmatchedLines: ['a few crushed nuts'] })).toEqual(['unmatched_line_term']);
  });

  it('unmatched lines without an excluded term are unverifiable unless explicitly allowed', () => {
    const r = { id: 'a', dietCategory: 'vegan' as const, unmatchedLines: ['1 tin of something'] };
    expect(codes({ excludeTerms: ['mushroom'] }, r)).toEqual(['unverified_ingredients']);
    expect(codes({ excludeTerms: ['mushroom'], allowUnverifiedIngredients: true }, r)).toEqual([]);
    expect(codes({}, r)).toEqual([]);
  });
});

describe('solver + validatePlan follow the same matching', () => {
  const lib = [
    recipe({ id: 'safe', dietCategory: 'vegan', ingredientIds: ['ing-rice'], ingredientNames: ['rice'] }),
    recipe({ id: 'group', dietCategory: 'vegan', ingredientIds: ['ing-cashew'], estCostPerServingPence: 1 }),
    recipe({ id: 'name', dietCategory: 'vegan', ingredientIds: ['ing-x'], ingredientNames: ['cashew nuts'], estCostPerServingPence: 1 }),
    recipe({ id: 'line', dietCategory: 'vegan', unmatchedLines: ['handful of cashews'], estCostPerServingPence: 1 }),
  ];
  const k: PlanConstraintsInput = { ...base, days: 3, repeats: 'allow', excludeAllergens: ['nuts'], allergenGroups: { nuts: ['ing-cashew'] }, excludeTerms: ['cashew'], allowUnverifiedIngredients: true };

  it('solver only ever uses the safe recipe', () => {
    const plan = solvePlan(k, lib);
    expect(plan.slots.map((s) => s.recipeId)).toEqual(['safe', 'safe', 'safe']);
    expect(plan.hardExclusions.excludedRecipes.map((e) => [e.recipeId, e.reasons[0]!.code])).toEqual([
      ['group', 'allergen'],
      ['line', 'unmatched_line_term'],
      ['name', 'excluded_term'],
    ]);
  });

  it('validatePlan rejects each violating recipe with the right code', () => {
    const v = validatePlan(
      { slots: [
        { date: '2026-10-19', mealType: 'dinner', recipeId: 'group' },
        { date: '2026-10-20', mealType: 'dinner', recipeId: 'name' },
        { date: '2026-10-21', mealType: 'dinner', recipeId: 'line' },
      ] },
      k,
      lib,
    );
    expect(v.ok).toBe(false);
    expect(v.hardViolations.map((h) => h.code)).toEqual(['allergen', 'excluded_term', 'unmatched_line_term']);
  });
});
