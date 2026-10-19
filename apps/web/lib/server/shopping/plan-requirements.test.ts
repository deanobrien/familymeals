import { describe, expect, it } from 'vitest';
import { getRecipeRepository } from '../../recipes/factory';
import type { PlanDoc } from '../../plan/types';
import { InMemoryMealPlanRepository } from '../plan/repository';
import { getIngredientCatalogue } from '../refdata/catalogue';
import { ApprovedPlanRequirementSource } from './approved-plan-source';
import { InMemoryShoppingRepository } from './repository';
import { generateFromPlan } from './service';

const HH = 'hh-plan-req';
const PASTA = '00000000-0000-4000-8000-000000000001'; // seed 01 tomato pasta
const STEW = '00000000-0000-4000-8000-000000000008'; // seed 08 chickpea stew
const doc = (status: PlanDoc['status']): PlanDoc => ({
  id: 'plan-1', householdId: HH, weekStart: '2026-10-19', mealTypes: ['dinner'], status, updatedAt: '2026-10-19T00:00:00.000Z',
  entries: {
    '2026-10-19|dinner': { kind: 'recipe', recipeId: PASTA, servings: 4 },
    '2026-10-20|dinner': { kind: 'eating_out' },
    '2026-10-21|dinner': { kind: 'recipe', recipeId: STEW, servings: 2 },
    '2026-10-22|dinner': { kind: 'recipe', recipeId: PASTA, servings: 8 },
  },
});

describe('ApprovedPlanRequirementSource (@fr/engine/aggregate over the recipe store)', () => {
  it('refuses drafts and unknown plans', async () => {
    const plans = new InMemoryMealPlanRepository();
    await plans.save(doc('draft'));
    const src = new ApprovedPlanRequirementSource(plans, getRecipeRepository());
    expect(await src.forPlan(HH, 'plan-1')).toBeNull();
    expect(await src.forPlan(HH, 'nope')).toBeNull();
    expect(await src.forPlan('other-household', 'plan-1')).toBeNull();
  });

  it('aggregates every planned line with provenance, scaled by servings, with aisles', async () => {
    const plans = new InMemoryMealPlanRepository();
    await plans.save(doc('approved'));
    const repo = getRecipeRepository();
    const src = new ApprovedPlanRequirementSource(plans, repo);
    const r = (await src.forPlan(HH, 'plan-1'))!;
    const pasta = (await repo.get(PASTA))!;
    const stew = (await repo.get(STEW))!;
    const contributions = r.requirements.flatMap((q) => q.contributions);
    // every line of every planned meal appears exactly once (pasta planned twice)
    expect(contributions).toHaveLength(pasta.ingredients.length * 2 + stew.ingredients.length);
    expect(new Set(contributions.map((c) => c.plannedMealId))).toEqual(new Set(['plan-1-0', 'plan-1-2', 'plan-1-3']));
    expect(r.recipeTitles[PASTA]).toBe(pasta.title);
    const cat = getIngredientCatalogue();
    for (const q of r.requirements) {
      if (q.ingredientId) expect(r.categories?.[q.ingredientId]).toBeTypeOf('string');
      if (q.ingredientId) expect(cat.get(q.ingredientId)).toBeDefined();
    }
    // a line planned at 4 and 8 servings of a 4-serving recipe sums to 3x the base amount
    const line = pasta.ingredients.find((l) => l.ingredientId && l.quantity.kind === 'exact' && l.quantity.unit === 'g');
    if (line && pasta.servings === 4 && !stew.ingredients.some((l) => l.ingredientId === line.ingredientId)) {
      const req = r.requirements.find((q) => q.ingredientId === line.ingredientId)!;
      expect(req.quantity.value).toBeCloseTo(line.quantity.value! * 3);
    }
  });

  it('generateFromPlan creates the shopping list from the approved plan', async () => {
    const plans = new InMemoryMealPlanRepository();
    await plans.save(doc('approved'));
    const shopping = new InMemoryShoppingRepository();
    let n = 0;
    const out = await generateFromPlan(shopping, new ApprovedPlanRequirementSource(plans, getRecipeRepository()), HH, 'plan-1', 'u1', () => `id-${++n}`);
    expect(out?.lineCount).toBeGreaterThan(0);
    const snap = await shopping.snapshot(HH);
    expect(Object.keys(snap.state.items).length).toBe(out!.lineCount);
  });
});
