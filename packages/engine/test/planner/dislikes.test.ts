import { describe, expect, it } from 'vitest';
import { solvePlan, type PlanConstraintsInput } from '../../src/planner/index';
import { familyLibrary, recipe } from './fixtures';

// P1-B (D378): soft per-person dislikes. Penalised by the solver, reported, NEVER excluded.
const base: PlanConstraintsInput = { startDate: '2026-10-19', days: 4, mealTypes: ['dinner'], servings: 4, repeats: 'avoid' };
const status = (plan: { report: { id: string; status: string }[] }, id: string) => plan.report.find((r) => r.id === id)?.status;

describe('soft dislikes', () => {
  it('prefers meals nobody dislikes when other constraints allow', () => {
    const lib = familyLibrary().map((r) => (['r01', 'r03', 'r08'].includes(r.id) ? { ...r, dislikedBy: ['sam'] } : r));
    const plan = solvePlan(base, lib, { labels: { members: { sam: 'Sam' } } });
    const used = plan.slots.filter((s) => s.recipeId).map((s) => s.recipeId);
    expect(used).toHaveLength(4);
    expect(used.filter((id) => ['r01', 'r03', 'r08'].includes(id!))).toEqual([]);
    expect(status(plan, 'dislikes')).toBe('met');
  });

  it('is NOT a hard exclusion: a disliked recipe is still used when it is the only way to fill the plan', () => {
    const lib = [
      recipe({ id: 'a', dietCategory: 'meat', dislikedBy: ['sam'] }),
      recipe({ id: 'b', dietCategory: 'meat', dislikedBy: ['sam'] }),
    ];
    const plan = solvePlan({ ...base, days: 2 }, lib, { labels: { members: { sam: 'Sam' } } });
    expect(plan.slots.filter((s) => s.recipeId).map((s) => s.recipeId).sort()).toEqual(['a', 'b']);
    const item = plan.report.find((r) => r.id === 'dislikes')!;
    expect(item.status).toBe('partially_met');
    expect(item.hard).toBe(false);
    expect(item.explanation).toMatch(/only a preference/i);
    const reasons = plan.slots.flatMap((s) => s.reasons).join(' ');
    expect(reasons).toMatch(/Sam doesn't like/);
  });

  it('a hard exclusion still wins over everything and dislikes never create hard reasons', () => {
    const lib = [
      recipe({ id: 'a', dietCategory: 'meat', dislikedBy: ['sam'] }),
      recipe({ id: 'b', dietCategory: 'meat', ingredientIds: ['ing-peanut'] }),
    ];
    const plan = solvePlan({ ...base, days: 2, excludeIngredientIds: ['ing-peanut'] }, lib);
    const used = plan.slots.map((s) => s.recipeId).filter(Boolean);
    expect(used.length).toBeGreaterThan(0);
    expect(used.every((id) => id === 'a')).toBe(true); // the peanut recipe is never used, the disliked one is
  });

  it('counts each member once per meal, so a meal two people dislike costs more than one', () => {
    const lib = [
      recipe({ id: 'one', dietCategory: 'meat', dislikedBy: ['sam'] }),
      recipe({ id: 'two', dietCategory: 'meat', dislikedBy: ['sam', 'lauren', 'sam'] }),
      recipe({ id: 'ok', dietCategory: 'meat' }),
    ];
    const plan = solvePlan({ ...base, days: 2 }, lib);
    const used = plan.slots.map((s) => s.recipeId).filter(Boolean).sort();
    expect(used).toEqual(['ok', 'one']);
  });

  it('reports nothing when nobody dislikes anything in the library', () => {
    const plan = solvePlan(base, familyLibrary());
    expect(plan.report.find((r) => r.id === 'dislikes')).toBeUndefined();
  });

  it('is deterministic', () => {
    const lib = familyLibrary().map((r, i) => (i % 3 === 0 ? { ...r, dislikedBy: ['sam'] } : r));
    const a = solvePlan(base, lib);
    const b = solvePlan(base, lib);
    expect(a.slots.map((s) => s.recipeId)).toEqual(b.slots.map((s) => s.recipeId));
  });
});
