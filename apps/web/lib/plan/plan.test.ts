import { describe, expect, it } from 'vitest';
import { addDays, mondayOf, weekDates } from './dates';
import { mealCost, weekCost, weekCostLabel } from './cost';
import { emptyDoc, markSlot, moveEntry, removeEntry, setNote, setRecipe, setServings, shiftToWeek, slotKey, swapRecipe } from './ops';
import { proportionsSentence, roundProportions } from './proportions';
import type { RecipeLite } from './types';

const recipe = (id: string, cost: number | null): RecipeLite => ({
  id, title: id, tags: [], mealTypes: ['dinner'], baseServings: 4,
  costPerServingPence: cost, costKind: cost == null ? null : 'estimate', excludedBy: [],
});
const R = new Map([recipe('a', 100), recipe('b', null)].map((r) => [r.id, r]));
const mon = { date: '2026-10-19', mealType: 'dinner' as const };
const tue = { date: '2026-10-20', mealType: 'dinner' as const };

describe('dates', () => {
  it('finds the Monday and the week', () => {
    expect(mondayOf('2026-10-25')).toBe('2026-10-19');
    expect(mondayOf('2026-10-19')).toBe('2026-10-19');
    expect(weekDates('2026-10-19')).toHaveLength(7);
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
  });
});

describe('plan ops', () => {
  const base = emptyDoc('p1', 'h', '2026-10-19');
  it('adds, swaps keeping servings, and reopens approved plans as drafts', () => {
    const a = setRecipe({ ...base, status: 'approved' }, mon, 'a', 4);
    expect(a.status).toBe('draft');
    expect(swapRecipe(setServings(a, mon, 6), mon, 'b').entries[slotKey(mon)]).toEqual({ kind: 'recipe', recipeId: 'b', servings: 6 });
  });
  it('moves, swaps on occupied target, and duplicates', () => {
    const d = setRecipe(setRecipe(base, mon, 'a', 4), tue, 'b', 2);
    const moved = moveEntry(d, mon, tue, 'move');
    expect(moved.entries[slotKey(tue)]).toMatchObject({ recipeId: 'a' });
    expect(moved.entries[slotKey(mon)]).toMatchObject({ recipeId: 'b' });
    const dup = moveEntry(setRecipe(base, mon, 'a', 4), mon, tue, 'duplicate');
    expect(Object.keys(dup.entries)).toHaveLength(2);
    expect(moveEntry(setRecipe(base, mon, 'a', 4), mon, tue, 'move').entries[slotKey(mon)]).toBeUndefined();
  });
  it('marks eating out / leftovers, keeps notes, removes', () => {
    const d = markSlot(setNote(setRecipe(base, mon, 'a', 4), mon, 'late shift'), mon, 'eating_out');
    expect(d.entries[slotKey(mon)]).toEqual({ kind: 'eating_out', note: 'late shift' });
    expect(removeEntry(d, mon).entries).toEqual({});
  });
  it('reuses a previous week shifted onto a new one', () => {
    const prev = setRecipe(base, tue, 'a', 3);
    const next = shiftToWeek(prev, '2026-10-26', 'p2');
    expect(next.id).toBe('p2');
    expect(next.entries['2026-10-27|dinner']).toMatchObject({ recipeId: 'a', servings: 3 });
    expect(next.status).toBe('draft');
  });
});

describe('cost honesty', () => {
  it('never treats unknown as zero', () => {
    expect(mealCost({ kind: 'recipe', recipeId: 'b', servings: 4 }, R)).toEqual({ status: 'uncosted' });
    expect(mealCost({ kind: 'recipe', recipeId: 'a', servings: 4 }, R)).toEqual({ status: 'estimate', pence: 400 });
    expect(mealCost({ kind: 'eating_out' }, R)).toEqual({ status: 'none' });
  });
  it('summarises the week', () => {
    const d = setRecipe(setRecipe(emptyDoc('p', 'h', '2026-10-19'), mon, 'a', 4), tue, 'b', 4);
    const c = weekCost(d, R);
    expect(c).toMatchObject({ knownPence: 400, costedMeals: 1, uncostedMeals: 1, status: 'partial' });
    expect(weekCostLabel(c)).toMatch(/At least £4\.00 \(estimate\); 1 meal uncosted/);
    expect(weekCostLabel(weekCost(emptyDoc('p', 'h', '2026-10-19'), R))).toMatch(/No meals/);
  });
});

describe('diet proportions', () => {
  it('rounds half-and-half over 7 days and explains it', () => {
    const r = roundProportions({ vegetarian: 0.5, meat: 0.5 }, 7);
    expect(r.counts.vegetarian + r.counts.meat).toBe(7);
    expect(r.explanations.join(' ')).toMatch(/cannot be cooked/);
  });
  it('uses largest remainder and normalises', () => {
    const r = roundProportions({ meat: 0.4, fish: 0.3, vegetarian: 0.3 }, 7);
    expect(r.counts).toEqual({ meat: 3, fish: 2, vegetarian: 2, vegan: 0 });
    expect(roundProportions({ meat: 1, vegetarian: 1 }, 4).explanations.join(' ')).toMatch(/scaled to 100%/);
    expect(roundProportions({ meat: 1, vegetarian: 1 }, 4).counts).toMatchObject({ meat: 2, vegetarian: 2 });
  });
  it('handles empty input and builds a prompt sentence', () => {
    expect(roundProportions({}, 7).explanations).toEqual([]);
    expect(proportionsSentence({ vegetarian: 0.5, fish: 0.3 })).toBe('Aim for roughly 30% fish, 50% vegetarian.');
  });
});
