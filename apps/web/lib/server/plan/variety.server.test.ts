import { describe, expect, it } from 'vitest';
import { createAiProvider } from '@fr/ai';
import * as h from './handlers';
import { createPlanServices } from './services';
import { RepositoryPlanRecipeSource } from './recipe-source';
import { InMemoryRecipeRepository } from '../../recipes/memory-repository';
import { loadSeedRecipes } from '../../recipes/seed';
import { withCanonicalIngredients } from '../../recipes/factory';

describe('plan page data carries the variety profile per recipe (P1-B, D376)', () => {
  it('gives every library recipe a profile computed from its weighed, matched ingredients', async () => {
    const repo = new InMemoryRecipeRepository(withCanonicalIngredients(loadSeedRecipes()));
    const svc = createPlanServices({ ai: createAiProvider({ AI_PROVIDER: 'mock', NODE_ENV: 'test' }), recipes: new RepositoryPlanRecipeSource(repo) });
    const page = await h.getPlanPageData(svc, '2026-10-19');
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
