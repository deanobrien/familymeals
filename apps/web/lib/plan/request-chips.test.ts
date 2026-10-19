import { describe, expect, it } from 'vitest';
import { PlanRequestSchema } from '@fr/domain';
import {
  addFavourite, addTerm, describeTarget, quickWeekdays, removeDietTarget, removeFavourite, removeTerm, setBudgetPounds, setDietTarget,
  setQuickMinutes, setQuickStrict, setServings, toggleQuickDay,
} from './request-chips';

const base = PlanRequestSchema.parse({
  days: 7, mealTypes: ['dinner'], servings: 4, budgetPence: 10000,
  dietProportions: { vegetarian: { fraction: 0.5 }, fish: { count: 2 } },
  excludeTerms: ['mushrooms'], favouritesOf: ['Lauren'], quickMeals: { weekdays: ['mon', 'tue'], maxTotalMinutes: 30 },
});

describe('constraint chip edits', () => {
  it('describes every diet target form', () => {
    expect(describeTarget('vegetarian', { fraction: 0.5 })).toBe('Vegetarian: about 50%');
    expect(describeTarget('fish', { count: 2 })).toBe('Fish: 2 meals');
    expect(describeTarget('vegan', { min: 1 })).toBe('Vegan: at least 1 meals');
    expect(describeTarget('meat', { max: 1 })).toBe('Meat: at most 1 meal');
  });

  it('every edit keeps the request valid against the shared schema', () => {
    let r = base;
    r = setServings(r, 6); r = setBudgetPounds(r, 85.5);
    r = setDietTarget(r, 'vegan', 'min', 1); r = setDietTarget(r, 'meat', 'percent', 25);
    r = addTerm(r, 'Soy'); r = addFavourite(r, 'Sam'); r = toggleQuickDay(r, 'thu'); r = setQuickStrict(r, true); r = setQuickMinutes(r, 20);
    expect(PlanRequestSchema.safeParse(r).success).toBe(true);
    expect(r).toMatchObject({ servings: 6, budgetPence: 8550, excludeTerms: ['mushrooms', 'Soy'], favouritesOf: ['Lauren', 'Sam'] });
    expect(r.dietProportions).toMatchObject({ vegan: { min: 1 }, meat: { fraction: 0.25 } });
    expect(r.quickMeals).toMatchObject({ weekdays: ['mon', 'tue', 'thu'], maxTotalMinutes: 20, strict: true });
  });

  it('removes chips, de-duplicates and clears empty groups', () => {
    expect(removeTerm(base, 'MUSHROOMS').excludeTerms).toEqual([]);
    expect(addTerm(base, ' Mushrooms ')).toBe(base);
    expect(removeFavourite(base, 'lauren').favouritesOf).toEqual([]);
    expect(removeDietTarget(removeDietTarget(base, 'fish'), 'vegetarian').dietProportions).toBeUndefined();
    expect(setBudgetPounds(base, null).budgetPence).toBeUndefined();
    const off = toggleQuickDay(toggleQuickDay(base, 'mon'), 'tue');
    expect(off.quickMeals).toBeUndefined();
    expect(quickWeekdays(toggleQuickDay(base, 'fri'))).toEqual(['mon', 'tue', 'fri']);
  });

  it('clamps servings and a non-positive budget', () => {
    expect(setServings(base, 0).servings).toBe(1);
    expect(setServings(base, 500).servings).toBe(50);
    expect(setBudgetPounds(base, -5).budgetPence).toBeUndefined();
  });
});
