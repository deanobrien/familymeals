import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { solvePlan, validatePlan, type PlanConstraintsInput, type RecipeCandidateInput } from '../../src/planner/index';

const INGREDIENTS = ['i0', 'i1', 'i2', 'i3', 'i4', 'i5', 'i6', 'i7'];
const ALLERGENS = ['peanuts', 'milk', 'eggs', 'gluten', 'sesame', 'fish'];
const TAGS = ['quick', 'kids', 'spicy', 'alcohol'];
const NAMES = ['Button Mushroom', 'peanut butter', 'Cashew nuts', 'rice', 'Cheddar cheese', 'salmon fillet', 'tofu'];
const LINES = ['2 handfuls of mushrooms', 'a splash of fish sauce', 'some crushed Peanuts', '1 tin chopped tomatoes', 'mystery spice'];
const TERMS = ['mushrooms', 'cashew', 'cheese', 'tomato'];
const GROUPS = { nuts: ['i1', 'i2'], milk: ['i3'], fish: ['i4'] };

const recipeArb = (id: string): fc.Arbitrary<RecipeCandidateInput> =>
  fc.record({
    id: fc.constant(id),
    dietCategory: fc.constantFrom('meat', 'fish', 'vegetarian', 'vegan'),
    tags: fc.subarray(TAGS),
    ingredientIds: fc.subarray(INGREDIENTS, { minLength: 1 }),
    unmatchedIngredientCount: fc.nat({ max: 2 }),
    ingredientNames: fc.subarray(NAMES),
    unmatchedLines: fc.subarray(LINES, { maxLength: 2 }),
    allergens: fc.subarray(ALLERGENS).map((xs) => xs.map((x, i) => (i % 2 ? x.toUpperCase() : x))),
    totalMinutes: fc.option(fc.integer({ min: 5, max: 180 }), { nil: null }),
    estCostPerServingPence: fc.option(fc.integer({ min: 50, max: 900 }), { nil: null }),
    favouritedBy: fc.subarray(['lauren', 'sam']),
    mealTypes: fc.option(fc.subarray(['breakfast', 'lunch', 'dinner'] as const, { minLength: 1 }), { nil: undefined }),
  }) as fc.Arbitrary<RecipeCandidateInput>;

const libraryArb = fc
  .integer({ min: 0, max: 18 })
  .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => recipeArb(`r${String(i).padStart(2, '0')}`))));

const constraintsArb: fc.Arbitrary<PlanConstraintsInput> = fc.record({
  startDate: fc.constant('2026-10-19'),
  days: fc.integer({ min: 1, max: 7 }),
  mealTypes: fc.subarray(['breakfast', 'lunch', 'dinner'] as const, { minLength: 1 }),
  servings: fc.integer({ min: 1, max: 6 }),
  budgetPence: fc.option(fc.integer({ min: 0, max: 20000 }), { nil: undefined }),
  excludeIngredientIds: fc.subarray(INGREDIENTS),
  excludeAllergens: fc.subarray([...ALLERGENS, 'nuts']),
  allergenGroups: fc.constant(GROUPS),
  excludeTerms: fc.subarray(TERMS),
  excludeDietCategories: fc.subarray(['meat', 'fish', 'vegetarian', 'vegan'] as const),
  excludeTags: fc.subarray(TAGS),
  allowUnverifiedIngredients: fc.boolean(),
  favouritesOf: fc.subarray(['lauren', 'sam']),
  repeats: fc.constantFrom('never', 'avoid', 'allow'),
  dietProportions: fc.record(
    { vegetarian: fc.record({ fraction: fc.double({ min: 0, max: 1, noNaN: true }) }), fish: fc.record({ count: fc.nat({ max: 4 }) }) },
    { requiredKeys: [] },
  ),
  quickMeals: fc.option(fc.record({ weekdays: fc.subarray(['mon', 'tue', 'wed'] as const), maxTotalMinutes: fc.integer({ min: 10, max: 60 }) }), { nil: undefined }),
}) as fc.Arbitrary<PlanConstraintsInput>;

describe('hard constraints are never violated (property)', () => {
  it('no planned meal contains an excluded ingredient, allergen, diet, tag or unverifiable lines', () => {
    fc.assert(
      fc.property(libraryArb, constraintsArb, fc.integer({ min: 0, max: 1000 }), (lib, k, seed) => {
        // Also try to sneak excluded recipes in as pins.
        const pins = lib.slice(0, 2).map((r, i) => ({ date: `2026-10-${19 + i}`, mealType: 'dinner' as const, recipeId: r.id }));
        const constraints = { ...k, locked: pins };
        const plan = solvePlan(constraints, lib, { seed, restarts: 2 });
        const byId = new Map(lib.map((r) => [r.id, r]));
        const exAll = new Set((k.excludeAllergens ?? []).map((a) => a.toLowerCase()));
        const strictUnverified = !k.allowUnverifiedIngredients &&
          ((k.excludeAllergens?.length ?? 0) > 0 || (k.excludeIngredientIds?.length ?? 0) > 0 || (k.excludeTerms?.length ?? 0) > 0);
        const groupIds = new Set((k.excludeAllergens ?? []).flatMap((a) => (GROUPS as Record<string, string[]>)[a.toLowerCase()] ?? []));
        // Independent (non-library) term check: substring of term or term minus trailing 's'.
        const terms = [...(k.excludeTerms ?? []), ...(k.excludeAllergens ?? [])].map((t) => t.toLowerCase());
        const mentions = (text: string) => terms.some((t) => text.toLowerCase().includes(t) || (t.length > 3 && t.endsWith('s') && text.toLowerCase().includes(t.slice(0, -1))));
        const used: string[] = [];
        for (const s of plan.slots) {
          if (!s.recipeId) continue;
          used.push(s.recipeId);
          const r = byId.get(s.recipeId)!;
          expect(r.ingredientIds!.some((i) => k.excludeIngredientIds!.includes(i))).toBe(false);
          expect(r.allergens!.some((a) => exAll.has(a.toLowerCase()))).toBe(false);
          expect(k.excludeDietCategories!.includes(r.dietCategory)).toBe(false);
          expect(r.tags!.some((t) => k.excludeTags!.includes(t))).toBe(false);
          expect(r.ingredientIds!.some((i) => groupIds.has(i))).toBe(false);
          expect(r.ingredientNames!.some(mentions)).toBe(false);
          expect(r.unmatchedLines!.some(mentions)).toBe(false); // fail safe, regardless of allowUnverified
          if (strictUnverified) {
            expect(r.unmatchedIngredientCount ?? 0).toBe(0);
            expect(r.unmatchedLines ?? []).toEqual([]);
          }
        }
        if (k.repeats === 'never') expect(new Set(used).size).toBe(used.length);
        const v = validatePlan(plan, constraints, lib);
        expect(v.hardViolations).toEqual([]);
        expect(v.ok).toBe(true);
        // Money stays integer pence.
        expect(Number.isInteger(plan.cost.totalPence)).toBe(true);
      }),
      { numRuns: 300, seed: 20261019 },
    );
  });
});
