import { describe, expect, it } from 'vitest';
import type { RecipeVarietyProfile } from '@fr/engine/nutrition';
import { cookedVariety, weekVariety } from './variety';
import { emptyDoc, setRecipe } from './ops';
import type { RecipeLite } from './types';
import * as h from '../server/plan/handlers';
import { createPlanServices } from '../server/plan/services';
import { createAiProvider } from '@fr/ai';
import { RepositoryPlanRecipeSource } from '../server/plan/recipe-source';
import { InMemoryRecipeRepository } from '../recipes/memory-repository';
import { loadSeedRecipes } from '../recipes/seed';
import { withCanonicalIngredients } from '../recipes/factory';

const profile = (over: Partial<RecipeVarietyProfile> = {}): RecipeVarietyProfile => ({ fv: 2, pulses: 0, plants: ['carrot'], proteinSources: [], proteins: [], unweighed: 0, ...over });
const lite = (id: string, variety: RecipeVarietyProfile | null): RecipeLite => ({ id, title: id, tags: [], mealTypes: ['dinner'], baseServings: 4, costPerServingPence: null, costKind: null, excludedBy: [], variety });
const WEEK = '2026-10-19';

describe('weekVariety (planner glue)', () => {
  it('summarises planned recipe meals only and reports meals without data', () => {
    let doc = emptyDoc('p', 'h', WEEK, ['dinner'], new Date('2026-10-19T09:00:00Z'));
    doc = setRecipe(doc, { date: WEEK, mealType: 'dinner' }, 'a', 4);
    doc = setRecipe(doc, { date: '2026-10-20', mealType: 'dinner' }, 'b', 4);
    doc = { ...doc, entries: { ...doc.entries, '2026-10-21|dinner': { kind: 'eating_out' } } };
    const v = weekVariety(doc, new Map([['a', lite('a', profile({ fv: 3 }))], ['b', lite('b', null)]]))!;
    expect(v.meals).toBe(2); // eating out is not a recipe meal
    expect(v.summary.mealsWithoutData).toBe(1);
    expect(v.summary.days.map((d) => d.portions)).toEqual([3, 0]);
  });
  it('is null for a week with no recipe meals, and for nothing cooked', () => {
    expect(weekVariety(emptyDoc('p', 'h', WEEK, ['dinner'], new Date()), new Map())).toBeNull();
    expect(cookedVariety([], new Map())).toBeNull();
  });
  it('summarises cooked meals the same way', () => {
    const v = cookedVariety([{ date: WEEK, recipeId: 'a' }], new Map([['a', lite('a', profile({ fv: 5 }))]]))!;
    expect(v.summary.daysWithFive).toBe(1);
  });
});

describe('plan page data carries the variety profile per recipe', () => {
  it('gives every library recipe a profile computed from its weighed, matched ingredients', async () => {
    const repo = new InMemoryRecipeRepository(withCanonicalIngredients(loadSeedRecipes()));
    const svc = createPlanServices({ ai: createAiProvider({ AI_PROVIDER: 'mock', NODE_ENV: 'test' }), recipes: new RepositoryPlanRecipeSource(repo) });
    const page = await h.getPlanPageData(svc, WEEK);
    expect(page.recipes.length).toBeGreaterThan(0);
    for (const r of page.recipes) {
      expect(r.variety).toMatchObject({ fv: expect.any(Number), pulses: expect.any(Number), plants: expect.any(Array), proteinSources: expect.any(Array), proteins: expect.any(Array), unweighed: expect.any(Number) });
      expect(r.variety!.fv).toBeGreaterThanOrEqual(0);
    }
    // at least one seeded recipe has vegetables, so the estimate is not all zeros
    expect(page.recipes.some((r) => (r.variety?.fv ?? 0) > 0 || (r.variety?.plants.length ?? 0) > 0)).toBe(true);
    expect(page.cooked).toBeUndefined(); // no cooking log yet: the web panel shows planned meals only
  });
});
