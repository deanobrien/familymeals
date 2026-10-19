import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../../../app/api/dev/reset/route';
import { getRecipeRepository } from '../../recipes/factory';
import { getShoppingRepository } from '../shopping/repository';
import { devToolsAllowed, resetInMemoryStores } from './reset';

afterEach(() => vi.unstubAllEnvs());

describe('dev reset (e2e only)', () => {
  it('is refused in production', async () => {
    expect(devToolsAllowed({ NODE_ENV: 'production' })).toBe(false);
    expect(devToolsAllowed({ NODE_ENV: 'development' })).toBe(true);
    vi.stubEnv('NODE_ENV', 'production');
    expect((await POST()).status).toBe(404);
  });

  it('wipes the shopping list and restores the recipe store in place', async () => {
    const shopping = getShoppingRepository();
    await shopping.submit('hh-reset', { type: 'add_item', commandId: 'c', actor: 'u', at: '2026-10-19T00:00:00Z', itemId: 'i', displayName: 'Tea', category: 'Other' });
    const recipes = getRecipeRepository();
    const before = (await recipes.list({ q: '', tags: [], sort: 'name', page: 1, pageSize: 100 })).total;
    const extra = (await recipes.duplicate('00000000-0000-4000-8000-000000000001'))!;
    expect(resetInMemoryStores()).toContain('recipes');
    expect(Object.keys((await shopping.snapshot('hh-reset')).state.items)).toHaveLength(0);
    expect(getRecipeRepository()).toBe(recipes); // same instance: the import sink keeps writing to it
    expect(await recipes.get(extra.id)).toBeNull();
    expect((await recipes.list({ q: '', tags: [], sort: 'name', page: 1, pageSize: 100 })).total).toBe(before);
  });
});

describe('recipe libraries are household-scoped in memory mode (D160)', () => {
  it('a recipe created in household A is invisible to B; every household starts from the seed; reset restores all', async () => {
    const { getRecipeRepositoryFor } = await import('../../recipes/factory');
    const q = { q: '', tags: [], sort: 'name' as const, page: 1, pageSize: 100 };
    const a = getRecipeRepositoryFor('e2e-scope-a');
    const b = getRecipeRepositoryFor('e2e-scope-b');
    const seedTotal = (await b.list(q)).total;
    expect(seedTotal).toBeGreaterThan(0);
    const copy = (await a.duplicate('00000000-0000-4000-8000-000000000001'))!;
    expect((await a.list(q)).total).toBe(seedTotal + 1);
    expect((await b.list(q)).total).toBe(seedTotal);
    expect(await b.get(copy.id)).toBeNull();
    expect(getRecipeRepositoryFor('e2e-scope-a')).toBe(a);
    resetInMemoryStores();
    expect(await a.get(copy.id)).toBeNull();
  });
});
