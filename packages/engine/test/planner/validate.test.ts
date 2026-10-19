import { describe, expect, it } from 'vitest';
import { PlanConstraintsSchema, solvePlan, validatePlan } from '../../src/planner/index';
import { briefConstraints, familyLibrary } from './fixtures';

describe('validatePlan', () => {
  const lib = familyLibrary();
  const plan = solvePlan(briefConstraints, lib);
  const edit = (date: string, recipeId: string | null) => ({
    slots: plan.slots.map((s) => (s.date === date ? { ...s, recipeId } : s)),
  });

  it('rejects a user swap to a recipe containing an excluded ingredient', () => {
    const v = validatePlan(edit('2026-10-20', 'r08'), briefConstraints, lib);
    expect(v.ok).toBe(false);
    expect(v.hardViolations[0]).toMatchObject({ code: 'excluded_ingredient', recipeId: 'r08', slotKey: '2026-10-20|dinner' });
    expect(v.report.find((r) => r.id === 'hard_exclusions')!.status).toBe('unmet');
  });

  it('rejects allergens, unknown recipes, out-of-range and skipped slots', () => {
    const k = { ...briefConstraints, excludeAllergens: ['crustaceans'], skip: [{ date: '2026-10-25', reason: 'eating_out' as const }] };
    const v = validatePlan(
      {
        slots: [
          { date: '2026-10-19', mealType: 'dinner', recipeId: 'r07' },
          { date: '2026-10-20', mealType: 'dinner', recipeId: 'ghost' },
          { date: '2026-11-01', mealType: 'dinner', recipeId: 'r01' },
          { date: '2026-10-25', mealType: 'dinner', recipeId: 'r02' },
          { date: '2026-10-21', mealType: 'lunch', recipeId: 'r02' },
        ],
      },
      k,
      lib,
    );
    expect(v.hardViolations.map((h) => h.code).sort()).toEqual(['allergen', 'skipped_slot_filled', 'slot_out_of_range', 'slot_out_of_range', 'unknown_recipe']);
    expect(v.ok).toBe(false);
  });

  it('flags duplicates and forbidden repeats; warns on servings change', () => {
    const v = validatePlan(
      {
        slots: [
          { date: '2026-10-19', mealType: 'dinner', recipeId: 'r01', servings: 6 },
          { date: '2026-10-19', mealType: 'dinner', recipeId: 'r02' },
          { date: '2026-10-20', mealType: 'dinner', recipeId: 'r01' },
        ],
      },
      { ...briefConstraints, repeats: 'never' },
      lib,
    );
    expect(v.hardViolations.map((h) => h.code).sort()).toEqual(['duplicate_slot', 'repeat_forbidden']);
    expect(v.warnings.join(' ')).toContain('6 servings');
  });

  it('re-scores soft constraints after edits (empty slot -> coverage partially met)', () => {
    const v = validatePlan(edit('2026-10-22', null), briefConstraints, lib);
    expect(v.ok).toBe(true);
    expect(v.report.find((r) => r.id === 'coverage')!.status).toBe('partially_met');
  });

  it('re-derives hard constraints from the current library (recipe changed since proposal)', () => {
    const changed = lib.map((r) => (r.id === plan.slots[0]!.recipeId ? { ...r, ingredientIds: ['ing-mushroom-button'] } : r));
    const v = validatePlan(plan, briefConstraints, changed);
    expect(v.ok).toBe(false);
  });
});

describe('PlanConstraints schema', () => {
  it('parses the brief example with defaults', () => {
    const k = PlanConstraintsSchema.parse(briefConstraints);
    expect(k.repeats).toBe('avoid');
    expect(k.vegetarianIncludesVegan).toBe(true);
    expect(k.excludeAllergens).toEqual([]);
  });
  it('rejects bad input', () => {
    expect(() => PlanConstraintsSchema.parse({ servings: 4 })).toThrow();
    expect(() => PlanConstraintsSchema.parse({ startDate: '2026-02-30', servings: 4 })).toThrow();
    expect(() => PlanConstraintsSchema.parse({ startDate: '2026-10-19', servings: 4, budgetPence: 99.5 })).toThrow();
    expect(() => PlanConstraintsSchema.parse({ startDate: '2026-10-19', servings: 4, dietProportions: { fish: { fraction: 0.2, count: 2 } } })).toThrow();
    expect(() => PlanConstraintsSchema.parse({ startDate: '2026-10-19', dates: ['2026-10-19'], servings: 4 })).toThrow();
  });
});
