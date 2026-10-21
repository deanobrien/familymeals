import { describe, expect, it } from 'vitest';
import { solvePlan, type PlanConstraintsInput } from '../../src/planner/index';
import { familyLibrary, recipe } from './fixtures';

// P3-B (D436): the opt-in nudge towards household nutrition goals is SOFT. It prefers well-fitting recipes when other
// constraints allow, never excludes a recipe, never overrides a hard exclusion, and does nothing when off (fit 0).
const base: PlanConstraintsInput = { startDate: '2026-10-19', days: 4, mealTypes: ['dinner'], servings: 4, repeats: 'avoid' };
const used = (plan: { slots: { recipeId: string | null }[] }) => plan.slots.map((s) => s.recipeId).filter((x): x is string => !!x);

describe('goal fit nudge', () => {
  it('prefers recipes that fit the goals when other constraints allow', () => {
    const fit = new Set(['r02', 'r05', 'r07', 'r09']);
    const lib = familyLibrary().map((r) => (fit.has(r.id) ? { ...r, goalFit: 1 } : r));
    const on = used(solvePlan(base, lib));
    expect(on).toHaveLength(4);
    expect(on.filter((id) => fit.has(id)).length).toBeGreaterThanOrEqual(3);
  });

  it('does nothing when off: identical plan with and without a zero fit', () => {
    const a = used(solvePlan(base, familyLibrary()));
    const b = used(solvePlan(base, familyLibrary().map((r) => ({ ...r, goalFit: 0 }))));
    expect(b).toEqual(a);
  });

  it('is soft: a poorly fitting recipe is still used when it is the only way to fill the plan', () => {
    const lib = [recipe({ id: 'a', dietCategory: 'meat', goalFit: 0 }), recipe({ id: 'b', dietCategory: 'meat', goalFit: 1 })];
    expect(used(solvePlan({ ...base, days: 2 }, lib)).sort()).toEqual(['a', 'b']);
  });

  it('never overrides a hard exclusion', () => {
    const lib = [
      recipe({ id: 'good', dietCategory: 'meat', goalFit: 1, ingredientIds: ['ing-peanut'] }),
      recipe({ id: 'plain', dietCategory: 'meat', goalFit: 0 }),
    ];
    const plan = solvePlan({ ...base, days: 1, excludeIngredientIds: ['ing-peanut'] }, lib);
    expect(used(plan)).toEqual(['plain']);
  });

  it('reports a non-hard "goals" item only when a nudge is active', () => {
    const lib = familyLibrary().map((r) => ({ ...r, goalFit: r.id === 'r02' ? 1 : 0 }));
    const item = solvePlan(base, lib).report.find((r) => r.id === 'goals');
    expect(item?.hard).toBe(false);
    expect(item?.explanation).toMatch(/gentle preference/);
    expect(solvePlan(base, familyLibrary()).report.find((r) => r.id === 'goals')).toBeUndefined();
  });
});
