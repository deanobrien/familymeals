import { describe, expect, it } from 'vitest';
import { createAiProvider } from '@fr/ai';
import { MemoryCookingStore, resetMemoryCooking } from '../cooking/memory-store';
import { loadCookedWeek } from '../cooking/service';
import * as h from './handlers';
import { createPlanServices } from './services';
import { RepositoryPlanRecipeSource } from './recipe-source';
import { InMemoryRecipeRepository } from '../../recipes/memory-repository';
import { loadSeedRecipes } from '../../recipes/seed';
import { withCanonicalIngredients } from '../../recipes/factory';

describe('cooked meals for the Cooked variety view (P1-A cooking log, D377)', () => {
  it('returns the week\'s cooked meals as { date, recipeId }, household-wide, and nothing outside the week', async () => {
    resetMemoryCooking();
    const hh = 'h-cooked';
    const at = (iso: string) => new MemoryCookingStore(() => new Date(iso));
    await at('2026-10-18T18:00:00Z').markCooked(hh, 'u1', 'r-before', { servings: 4 }); // Sunday before the week
    await at('2026-10-19T18:30:00Z').markCooked(hh, 'u1', 'r1', { servings: 4 });
    await at('2026-10-24T12:00:00Z').markCooked(hh, 'u2', 'r2', { servings: 2 }); // another member
    await at('2026-10-26T00:00:00Z').markCooked(hh, 'u1', 'r-after', { servings: 4 }); // next Monday
    await at('2026-10-20T18:00:00Z').markCooked('h-other', 'u9', 'r-other', { servings: 4 }); // another household
    const rows = await loadCookedWeek({ householdId: hh, client: null }, '2026-10-19');
    expect(rows).toEqual([{ date: '2026-10-19', recipeId: 'r1' }, { date: '2026-10-24', recipeId: 'r2' }]);
    expect(await loadCookedWeek({ householdId: hh, client: null }, 'not-a-date')).toBeUndefined();
    expect(await loadCookedWeek({ householdId: 'h-empty', client: null }, '2026-10-19')).toEqual([]);
    resetMemoryCooking();
  });
});

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
