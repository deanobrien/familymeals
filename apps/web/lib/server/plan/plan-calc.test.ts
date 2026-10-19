import { describe, expect, it } from 'vitest';
import { withCanonicalIngredients } from '../../recipes/factory';
import { InMemoryRecipeRepository } from '../../recipes/memory-repository';
import { loadSeedRecipes } from '../../recipes/seed';
import { weekCost, weekCostLabel } from '../../plan/cost';
import { weekNutrition } from '../../plan/nutrition';
import { emptyDoc, setRecipe } from '../../plan/ops';
import type { RecipeLite } from '../../plan/types';
import { createRecipeCalculator } from '../calc';
import { RepositoryPlanRecipeSource } from './recipe-source';

const calc = createRecipeCalculator();
const repo = new InMemoryRecipeRepository(withCanonicalIngredients(loadSeedRecipes()), calc);
const source = new RepositoryPlanRecipeSource(repo, (r) => calc.nutritionPerServing(r));

const lite = async (): Promise<Map<string, RecipeLite>> => {
  const all = await source.list();
  return new Map(all.map((r) => [r.id, {
    id: r.id, title: r.title, tags: r.tags, mealTypes: r.mealTypes, baseServings: r.baseServings,
    costPerServingPence: r.costPerServingPence, costKind: r.costPerServingPence == null ? null : 'estimate' as const,
    ...(r.costPartial ? { costPartial: true } : {}), nutritionPerServing: r.nutritionPerServing ?? null, excludedBy: [],
  }]));
};

describe('planner over computed cost and nutrition', () => {
  it('plan recipes carry computed (not placeholder) per-serving cost and nutrition', async () => {
    const [pasta] = await source.get('h', [(await repo.list({ q: 'tomato pasta', tags: [], sort: 'name', page: 1, pageSize: 5 })).items[0]!.id]);
    expect(pasta?.costPerServingPence).toBe(68);
    expect(pasta?.nutritionPerServing?.energy_kcal).toBeDefined();
  });

  it('week cost is a lower bound when recipes have unpriced ingredients', async () => {
    const recipes = await lite();
    const pasta = [...recipes.values()].find((r) => r.title === 'Sunday Tomato Pasta')!;
    let doc = emptyDoc('p', 'h', '2026-10-19');
    doc = setRecipe(doc, { date: '2026-10-19', mealType: 'dinner' }, pasta.id, 4);
    const c = weekCost(doc, recipes);
    expect(c.costedMeals).toBe(1);
    expect(c.knownPence).toBe(pasta.costPerServingPence! * 4);
    if (pasta.costPartial) {
      expect(c.status).toBe('partial');
      expect(weekCostLabel(c)).toMatch(/At least .*unpriced/);
    } else {
      expect(weekCostLabel(c)).toMatch(/About/);
    }
  });

  it('weekly nutrition sums servings, flags meals without data and carries the disclaimer; no adequacy claims', async () => {
    const recipes = await lite();
    const loaf = [...recipes.values()].find((r) => r.title === 'Lemon Drizzle Loaf')!;
    let doc = emptyDoc('p', 'h', '2026-10-19');
    doc = setRecipe(doc, { date: '2026-10-19', mealType: 'dinner' }, loaf.id, 2);
    doc = setRecipe(doc, { date: '2026-10-20', mealType: 'dinner' }, loaf.id, 2);
    const w = weekNutrition(doc, recipes)!;
    expect(w.summary.dayCount).toBe(2);
    expect(w.summary.totalServings).toBe(4);
    const per = loaf.nutritionPerServing!.energy_kcal.value!;
    expect(w.summary.totals.energy_kcal.value).toBeCloseTo(per * 4, 5);
    expect(w.summary.perDayAverage.energy_kcal.value).toBeCloseTo(per * 2, 5);
    expect(w.summary.disclaimer).toMatch(/not medical or dietary advice/);
    expect(JSON.stringify(w.summary)).not.toMatch(/recommended|target|deficien/i);

    // a meal with no nutrition makes the total unknown, never zero
    const bare = { ...loaf, id: 'bare', title: 'Bare', nutritionPerServing: null };
    const m2 = new Map(recipes).set('bare', bare);
    const w2 = weekNutrition(setRecipe(doc, { date: '2026-10-21', mealType: 'dinner' }, 'bare', 1), m2)!;
    expect(w2.mealsWithoutNutrition).toBe(1);
    expect(w2.summary.totals.energy_kcal.status).toBe('unknown');
    expect(w2.summary.totals.energy_kcal.value).toBeUndefined();
  });

  it('is null for an empty plan', async () => {
    expect(weekNutrition(emptyDoc('p', 'h', '2026-10-19'), await lite())).toBeNull();
  });
});
