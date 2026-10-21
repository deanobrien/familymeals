import { describe, expect, it } from 'vitest';
import { cookedGoals, swapCandidates, weekGoals } from './goals';
import type { PlanDoc, RecipeLite } from './types';

const WEEK = '2026-10-19';
const lite = (id: string, title: string, fv: number | null, over: Partial<RecipeLite> = {}): RecipeLite => ({
  id, title, tags: [], mealTypes: ['dinner'], baseServings: 4, costPerServingPence: null, costKind: null, excludedBy: [],
  variety: fv === null ? null : { fv, pulses: 0, plants: [], proteinSources: [], proteins: [], unweighed: 0 },
  goals: fv === null ? null : { oilyFishPortions: 0, oilyUnweighed: 0, redProcessedMeatG: 0, redUnweighed: 0 }, ...over,
});
const map = new Map([lite('a', 'Low veg pie', 1), lite('b', 'Veg stew', 5), lite('c', 'No data stew', null), lite('d', 'Nut roast', 6, { excludedBy: ['peanuts'] })].map((r) => [r.id, r]));
const doc = (entries: PlanDoc['entries']): PlanDoc => ({ id: 'p', householdId: 'h', weekStart: WEEK, mealTypes: ['dinner'], entries, status: 'draft', updatedAt: '' });
const entry = (recipeId: string) => ({ kind: 'recipe' as const, recipeId, servings: 4 });
const my = { goals: ['more_fruit_veg' as const], portionShare: 1 };

describe('weekGoals', () => {
  it('shows nothing without goals or consent (null in, null out)', () => {
    expect(weekGoals(null, doc({ [`${WEEK}|dinner`]: entry('a') }), map)).toBeNull();
    expect(weekGoals({ goals: [], portionShare: 1 }, doc({ [`${WEEK}|dinner`]: entry('a') }), map)).toBeNull();
  });

  it('counts recipe meals only and scales by the portion share', () => {
    const d = doc({ [`${WEEK}|dinner`]: entry('b'), '2026-10-20|dinner': { kind: 'eating_out' } });
    const full = weekGoals(my, d, map)!;
    expect(full.meals).toBe(1);
    expect(full.summary.progress[0]!.amount).toBe(5);
    expect(weekGoals({ ...my, portionShare: 0.5 }, d, map)!.summary.progress[0]!.amount).toBe(2.5);
  });

  it('a meal with no data makes the figure "at least" and no hint is given', () => {
    const w = weekGoals(my, doc({ [`${WEEK}|dinner`]: entry('a'), '2026-10-20|dinner': entry('c') }), map)!;
    expect(w.summary.progress[0]).toMatchObject({ atLeast: true, mealsMissingData: 1 });
    expect(w.hints).toEqual([]);
  });

  it('a clearly low week on complete data gets one gentle swap hint from a recipe with no household exclusion', () => {
    const w = weekGoals(my, doc({ [`${WEEK}|dinner`]: entry('a') }), map)!;
    expect(w.hints).toHaveLength(1);
    expect(w.hints[0]!.text).toMatch(/on the low side for fruit and veg/);
    expect(w.hints[0]!.swap).toMatchObject({ fromTitle: 'Low veg pie', toTitle: 'Veg stew' }); // never Nut roast (excluded)
  });
});

describe('swapCandidates / cookedGoals', () => {
  it('drops recipes that hit a household exclusion', () => {
    expect(swapCandidates(map).map((c) => c.recipeId).sort()).toEqual(['a', 'b', 'c']);
  });
  it('cooked view: null when nothing cooked, no hints for meals already eaten', () => {
    expect(cookedGoals(my, [], map)).toBeNull();
    const c = cookedGoals(my, [{ date: WEEK, recipeId: 'a' }], map)!;
    expect(c.summary.progress[0]!.status).toBe('off');
    expect(c.hints).toEqual([]);
  });
});
