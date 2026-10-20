import { describe, expect, it } from 'vitest';
import { resolveTarget, solvePlan, validatePlan, type PlanConstraintsInput, type RecipeCandidateInput } from '../../src/planner/index';
import { MUSHROOM_IDS, briefConstraints, familyLibrary, recipe } from './fixtures';

const status = (plan: { report: { id: string; status: string }[] }, id: string) => plan.report.find((r) => r.id === id)?.status;

describe("brief example prompt", () => {
  const lib = familyLibrary();
  const plan = solvePlan(briefConstraints, lib, { labels: { members: { lauren: 'Lauren' } } });
  const byId = new Map(lib.map((r) => [r.id, r]));
  const filled = plan.slots.filter((s) => s.recipeId);

  it('fills all seven dinners', () => {
    expect(plan.slots).toHaveLength(7);
    expect(filled).toHaveLength(7);
    expect(status(plan, 'coverage')).toBe('met');
  });

  it('never uses mushrooms (hard)', () => {
    for (const s of filled) {
      const ings = byId.get(s.recipeId!)!.ingredientIds ?? [];
      expect(ings.some((i) => MUSHROOM_IDS.includes(i))).toBe(false);
    }
    expect(status(plan, 'hard_exclusions')).toBe('met');
  });

  it('meets diet proportions with documented rounding', () => {
    const fish = filled.filter((s) => s.dietCategory === 'fish').length;
    const veg = filled.filter((s) => s.dietCategory === 'vegetarian' || s.dietCategory === 'vegan').length;
    expect(fish).toBe(2);
    expect(veg).toBeGreaterThanOrEqual(3);
    expect(veg).toBeLessThanOrEqual(4);
    expect(status(plan, 'diet:vegetarian')).toBe('met');
    expect(status(plan, 'diet:fish')).toBe('met');
    expect(plan.notes.join(' ')).toMatch(/50% of 7 meals = 3\.5, so 3–4 .* rounded to whole meals/);
  });

  it('stays within budget and reports uncosted meals', () => {
    expect(plan.cost.totalPence).toBeLessThanOrEqual(10_000);
    expect(plan.cost.costedMeals + plan.cost.uncostedMeals).toBe(7);
    expect(['met', 'uncertain']).toContain(status(plan, 'budget'));
    expect(Number.isInteger(plan.cost.totalPence)).toBe(true);
  });

  it("uses Lauren's favourites and quick meals on busy evenings", () => {
    expect(plan.stats.favourites).toBeGreaterThanOrEqual(2);
    expect(status(plan, 'quick_meals')).toBe('met');
    for (const s of plan.slots.slice(0, 4)) expect(s.totalMinutes!).toBeLessThanOrEqual(30);
    expect(plan.slots.some((s) => s.reasons.some((r) => r.includes('Favourite of Lauren')))).toBe(true);
  });

  it('passes validatePlan before save', () => {
    const v = validatePlan(plan, briefConstraints, lib);
    expect(v.ok).toBe(true);
    expect(v.hardViolations).toEqual([]);
  });

  it('has no repeats', () => {
    expect(new Set(filled.map((s) => s.recipeId)).size).toBe(7);
  });
});

describe('impossible constraints', () => {
  it('explains a library that is too small for a diet target and flags a gap', () => {
    const lib = [
      recipe({ id: 'f1', title: 'Fish pie', dietCategory: 'fish' }),
      ...['m1', 'm2', 'm3', 'm4', 'm5', 'm6'].map((id) => recipe({ id, dietCategory: 'meat' })),
    ];
    const plan = solvePlan({ startDate: '2026-10-19', servings: 4, dietProportions: { fish: { count: 2 } } }, lib);
    const fish = plan.report.find((r) => r.id === 'diet:fish')!;
    expect(fish.status).toBe('partially_met');
    expect(fish.explanation).toContain('Only 1 fish recipe in your library meets');
    expect(fish.explanation).toContain('2 requested');
    const gap = plan.suggestions.find((s) => s.criteria.dietCategory === 'fish')!;
    expect(gap.kind).toBe('new_recipe_suggestion_needed');
    expect(gap.count).toBe(1);
    expect(plan.explanations.some((e) => e.includes('Only 1 fish recipe'))).toBe(true);
  });

  it('mentions recipes lost to exclusions', () => {
    const lib = [
      recipe({ id: 'f1', dietCategory: 'fish' }),
      recipe({ id: 'f2', dietCategory: 'fish', allergens: ['Fish', 'Crustaceans'] }),
      ...['m1', 'm2', 'm3', 'm4', 'm5', 'm6'].map((id) => recipe({ id, dietCategory: 'meat' })),
    ];
    const plan = solvePlan({ startDate: '2026-10-19', servings: 2, dietProportions: { fish: { count: 2 } }, excludeAllergens: ['crustaceans'] }, lib);
    expect(plan.slots.some((s) => s.recipeId === 'f2')).toBe(false);
    expect(plan.report.find((r) => r.id === 'diet:fish')!.explanation).toContain('(1 more excluded by allergies/exclusions)');
  });

  it('leaves slots empty rather than violate an allergen', () => {
    const lib = [recipe({ id: 'p1', dietCategory: 'meat', allergens: ['peanuts'] }), recipe({ id: 'p2', dietCategory: 'vegan', allergens: ['PEANUTS'] })];
    const plan = solvePlan({ startDate: '2026-10-19', days: 3, servings: 2, excludeAllergens: ['peanuts'] }, lib);
    expect(plan.slots.every((s) => s.status === 'empty' && s.recipeId === null)).toBe(true);
    expect(plan.report.find((r) => r.id === 'coverage')!.status).toBe('unmet');
    expect(plan.explanations.join(' ')).toMatch(/no recipe in your library meets the hard constraints/);
    expect(plan.suggestions[0]!.count).toBe(3);
    expect(plan.suggestions[0]!.criteria.excludeAllergens).toEqual(['peanuts']);
  });

  it('excludes unverifiable recipes (unmatched ingredient lines) when exclusions exist', () => {
    const lib = [recipe({ id: 'u1', dietCategory: 'meat', unmatchedIngredientCount: 2 }), recipe({ id: 'ok', dietCategory: 'meat' })];
    const k: PlanConstraintsInput = { startDate: '2026-10-19', days: 2, servings: 2, excludeAllergens: ['sesame'] };
    expect(solvePlan(k, lib).slots.every((s) => s.recipeId === 'ok')).toBe(true);
    expect(solvePlan({ ...k, allowUnverifiedIngredients: true }, lib).slots.some((s) => s.recipeId === 'u1')).toBe(true);
    // Without any ingredient/allergen exclusions the unmatched lines are irrelevant.
    expect(solvePlan({ startDate: '2026-10-19', days: 2, servings: 2 }, lib).slots.map((s) => s.recipeId).sort()).toEqual(['ok', 'u1']);
  });

  it('reports an unreachable budget with the cheapest possible total and a cheaper-recipe gap', () => {
    const lib = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id, i) => recipe({ id, dietCategory: 'meat', estCostPerServingPence: 500 + i * 10 }));
    const plan = solvePlan({ startDate: '2026-10-19', servings: 4, budgetPence: 5_000 }, lib);
    const b = plan.report.find((r) => r.id === 'budget')!;
    expect(b.status).toBe('unmet');
    expect(b.explanation).toMatch(/over the £50\.00 budget/);
    expect(b.explanation).toMatch(/Even the cheapest eligible recipes would cost about £140\.00/);
    expect(plan.cost.totalPence).toBe(14_840); // repeats not worth it at this price gap
    expect(plan.cost.withinBudget).toBe(false);
    expect(plan.suggestions.some((s) => s.criteria.maxCostPerServingPence === Math.floor(5000 / 28))).toBe(true);
  });

  it('notes conflicting diet targets that exceed the number of meals', () => {
    const lib = [...Array(10)].map((_, i) => recipe({ id: `r${i}`, dietCategory: i % 2 ? 'fish' : 'meat' }));
    const plan = solvePlan({ startDate: '2026-10-19', servings: 2, dietProportions: { fish: { count: 5 }, meat: { count: 5 } } }, lib);
    expect(plan.notes.join(' ')).toContain('need at least 10 meals but the plan has 7');
  });

  it('repeats:never leaves a slot empty instead of repeating', () => {
    const lib = [recipe({ id: 'a', dietCategory: 'meat' }), recipe({ id: 'b', dietCategory: 'meat' })];
    const plan = solvePlan({ startDate: '2026-10-19', days: 3, servings: 2, repeats: 'never' }, lib);
    expect(plan.slots.filter((s) => s.recipeId).length).toBe(2);
    expect(plan.explanations.join(' ')).toContain("repeats are set to 'never'");
    const avoid = solvePlan({ startDate: '2026-10-19', days: 3, servings: 2 }, lib);
    expect(avoid.slots.filter((s) => s.recipeId).length).toBe(3);
    expect(avoid.report.find((r) => r.id === 'variety')!.status).toBe('partially_met');
  });

  it('handles an empty library', () => {
    const plan = solvePlan({ startDate: '2026-10-19', servings: 2 }, []);
    expect(plan.slots.every((s) => s.status === 'empty')).toBe(true);
    expect(plan.cost.totalPence).toBe(0);
  });
});

describe('proportion rounding', () => {
  it.each([
    [0.5, 7, 3, 4],
    [0.3, 7, 2, 3],
    [1, 7, 7, 7],
    [0, 7, 0, 0],
    [0.5, 6, 3, 3],
    [2 / 7, 7, 2, 2],
    [0.25, 5, 1, 2],
  ])('fraction %d of %d meals -> [%d, %d]', (f, n, lo, hi) => {
    const t = resolveTarget('vegetarian', { fraction: f }, n);
    expect([t.lo, t.hi]).toEqual([lo, hi]);
  });

  it('applies the fraction to plannable slots only (skipped days excluded)', () => {
    const lib = familyLibrary();
    const plan = solvePlan(
      { ...briefConstraints, skip: [{ date: '2026-10-24', reason: 'eating_out' }, { date: '2026-10-25', reason: 'leftovers' }] },
      lib,
    );
    expect(plan.slots.filter((s) => s.status === 'skipped').map((s) => s.skipReason)).toEqual(['eating_out', 'leftovers']);
    const veg = plan.report.find((r) => r.id === 'diet:vegetarian')!;
    expect(veg.target).toBe('2–3'); // 50% of 5 = 2.5
    expect(veg.status).toBe('met');
  });

  it('supports min/max targets and vegan nesting', () => {
    expect(resolveTarget('fish', { min: 2 }, 7)).toMatchObject({ lo: 2, hi: 7 });
    const lib = [...Array(7)].map((_, i) => recipe({ id: `v${i}`, dietCategory: 'vegan' }));
    const nested = solvePlan({ startDate: '2026-10-19', servings: 2, dietProportions: { vegetarian: { fraction: 1 } } }, lib);
    expect(nested.report.find((r) => r.id === 'diet:vegetarian')!.status).toBe('met');
    const strict = solvePlan({ startDate: '2026-10-19', servings: 2, vegetarianIncludesVegan: false, dietProportions: { vegetarian: { fraction: 1 } } }, lib);
    expect(strict.report.find((r) => r.id === 'diet:vegetarian')!.status).toBe('unmet');
  });
});

describe('budget and cost tie-breaks', () => {
  it('prefers the cheaper of otherwise-identical recipes', () => {
    const lib = [
      recipe({ id: 'dear', dietCategory: 'meat', estCostPerServingPence: 400 }),
      recipe({ id: 'cheap', dietCategory: 'meat', estCostPerServingPence: 300 }),
    ];
    for (const seed of [1, 2, 3, 42, 999]) {
      const plan = solvePlan({ startDate: '2026-10-19', days: 1, servings: 4 }, lib, { seed });
      expect(plan.slots[0]!.recipeId).toBe('cheap');
    }
  });

  it('trades a favourite for budget when the budget would otherwise be broken', () => {
    const lib = [
      recipe({ id: 'fav', dietCategory: 'meat', estCostPerServingPence: 1000, favouritedBy: ['lauren'] }),
      recipe({ id: 'thrifty', dietCategory: 'meat', estCostPerServingPence: 300 }),
    ];
    const tight = solvePlan({ startDate: '2026-10-19', days: 1, servings: 4, budgetPence: 1500, favouritesOf: ['lauren'] }, lib);
    expect(tight.slots[0]!.recipeId).toBe('thrifty');
    const loose = solvePlan({ startDate: '2026-10-19', days: 1, servings: 4, budgetPence: 5000, favouritesOf: ['lauren'] }, lib);
    expect(loose.slots[0]!.recipeId).toBe('fav');
  });

  it('flags uncosted meals: budget status uncertain and total is a lower bound', () => {
    const lib = [recipe({ id: 'x', dietCategory: 'meat', estCostPerServingPence: null })];
    const plan = solvePlan({ startDate: '2026-10-19', days: 1, servings: 4, budgetPence: 5000 }, lib);
    expect(plan.cost).toMatchObject({ uncostedMeals: 1, costedMeals: 0, isLowerBound: true, totalPence: 0 });
    expect(plan.report.find((r) => r.id === 'budget')!.status).toBe('uncertain');
  });
});

describe('determinism', () => {
  const lib = familyLibrary();
  it('same input + seed -> identical output', () => {
    const a = solvePlan(briefConstraints, lib, { seed: 7 });
    const b = solvePlan(briefConstraints, lib, { seed: 7 });
    expect(b).toEqual(a);
  });

  it('library order does not matter', () => {
    const shuffled: RecipeCandidateInput[] = [...lib].reverse();
    const a = solvePlan(briefConstraints, lib, { seed: 3 });
    const b = solvePlan(briefConstraints, shuffled, { seed: 3 });
    expect(b.slots.map((s) => s.recipeId)).toEqual(a.slots.map((s) => s.recipeId));
  });

  it('seed only changes ties, never quality', () => {
    const lib2 = [...Array(10)].map((_, i) => recipe({ id: `t${i}`, dietCategory: 'meat', estCostPerServingPence: 300 }));
    const plans = [1, 2, 3, 4, 5].map((seed) => solvePlan({ startDate: '2026-10-19', days: 3, servings: 2 }, lib2, { seed }));
    const scores = new Set(plans.map((p) => p.score));
    expect(scores.size).toBe(1);
    const choices = new Set(plans.map((p) => p.slots.map((s) => s.recipeId).join()));
    expect(choices.size).toBeGreaterThan(1); // tie-break actually varies with seed
  });
});

describe('pins, skips and recency', () => {
  it('keeps a valid pin and drops one that violates a hard constraint', () => {
    const lib = familyLibrary();
    const plan = solvePlan(
      {
        ...briefConstraints,
        locked: [
          { date: '2026-10-25', mealType: 'dinner', recipeId: 'r14' },
          { date: '2026-10-24', mealType: 'dinner', recipeId: 'r08' }, // mushroom risotto
        ],
      },
      lib,
    );
    expect(plan.slots.find((s) => s.date === '2026-10-25')!.recipeId).toBe('r14');
    expect(plan.slots.find((s) => s.date === '2026-10-24')!.recipeId).not.toBe('r08');
    const pinned = plan.report.find((r) => r.id === 'pinned')!;
    expect(pinned.status).toBe('partially_met');
    expect(pinned.explanation).toContain('Mushroom risotto');
  });

  it('avoids recently cooked recipes when alternatives exist', () => {
    const lib = [
      recipe({ id: 'recent', dietCategory: 'meat', estCostPerServingPence: 100, lastCookedOn: '2026-10-17' }),
      recipe({ id: 'fresh', dietCategory: 'meat', estCostPerServingPence: 300 }),
    ];
    const plan = solvePlan({ startDate: '2026-10-19', days: 1, servings: 2 }, lib);
    expect(plan.slots[0]!.recipeId).toBe('fresh');
  });

  it('respects meal-type suitability and multiple meal types', () => {
    const lib = [
      recipe({ id: 'porridge', dietCategory: 'vegan', mealTypes: ['breakfast'] }),
      recipe({ id: 'stew', dietCategory: 'meat', mealTypes: ['dinner'] }),
    ];
    const plan = solvePlan({ startDate: '2026-10-19', days: 2, servings: 2, mealTypes: ['dinner', 'breakfast'], repeats: 'allow' }, lib);
    for (const s of plan.slots) expect(s.recipeId).toBe(s.mealType === 'breakfast' ? 'porridge' : 'stew');
    expect(plan.slots.map((s) => s.mealType)).toEqual(['breakfast', 'dinner', 'breakfast', 'dinner']);
  });
});

describe('ratings from cooking (P1-A)', () => {
  const base = { startDate: '2026-10-19', days: 1, servings: 4 } as PlanConstraintsInput;
  it('prefers the recipe the household rated highly when everything else is equal', () => {
    const lib = [recipe({ id: 'low', dietCategory: 'meat', rating: 1 }), recipe({ id: 'high', dietCategory: 'meat', rating: 5 }), recipe({ id: 'unrated', dietCategory: 'meat' })];
    const plan = solvePlan(base, lib);
    expect(plan.slots.find((s) => s.recipeId)?.recipeId).toBe('high');
    expect(plan.stats.ratingPoints).toBe(2);
  });
  it('is only a nudge: a rated recipe never beats a hard exclusion', () => {
    const lib = [recipe({ id: 'banned', dietCategory: 'meat', rating: 5, ingredientIds: ['ing-mushroom-button'] }), recipe({ id: 'fine', dietCategory: 'meat', rating: 1 })];
    const plan = solvePlan({ ...base, excludeIngredientIds: MUSHROOM_IDS }, lib);
    expect(plan.slots.find((s) => s.recipeId)?.recipeId).toBe('fine');
  });
});
