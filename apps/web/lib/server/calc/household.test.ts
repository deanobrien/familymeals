import { describe, expect, it } from 'vitest';
import { InMemoryRecipeRepository } from '../../recipes/memory-repository';
import { loadSeedRecipes } from '../../recipes/seed';
import { withCanonicalIngredients } from '../../recipes/factory';
import { getPriceStore } from '../prices/store';
import { resetRecipeCalculators } from './index';
import { createSessionSummariser, summariserForHousehold } from './household';

const kg = { kind: 'exact' as const, value: 1, unit: 'kg' as const, originalText: '1kg' };
const TOMATO_PASTA = '00000000-0000-4000-8000-000000000001';

describe('household-scoped recipe costs (D100, D101)', () => {
  it("one household's receipt prices never change another household's recipe cost, through the shared recipe repository", async () => {
    getPriceStore().reset();
    resetRecipeCalculators();
    let current: string | null = 'hh-a';
    const repo = new InMemoryRecipeRepository(withCanonicalIngredients(loadSeedRecipes()), createSessionSummariser(async () => current));

    const base = (await repo.get(TOMATO_PASTA))!;
    const line = base.ingredients.find((l) => l.ingredientId && l.quantity.unit === 'g')!;
    getPriceStore().record('hh-a', [{ ingredientId: line.ingredientId!, pricePence: 1, packQuantity: kg, kind: 'receipt', observedOn: '2026-10-19', source: 'receipt:a' }]);

    current = 'hh-a';
    const a = (await repo.get(TOMATO_PASTA))!.cost.totalPence!;
    current = 'hh-b';
    const b = (await repo.get(TOMATO_PASTA))!.cost.totalPence!;
    current = null; // no session: generic prices only
    const none = (await repo.get(TOMATO_PASTA))!.cost.totalPence!;
    expect(a).toBeLessThan(b);
    expect(none).toBe(b);
    // list uses the same per-household costs
    current = 'hh-a';
    const listed = (await repo.list({ q: 'tomato', tags: [], sort: 'name', page: 1, pageSize: 50 })).items.find((r) => r.id === TOMATO_PASTA)!;
    expect(listed.cost.totalPence).toBe(a);
    getPriceStore().reset();
    resetRecipeCalculators();
  });

  it('the per-household summariser (Supabase mode) agrees with the in-memory one for the same household', async () => {
    getPriceStore().reset();
    resetRecipeCalculators();
    const recipe = withCanonicalIngredients(loadSeedRecipes()).find((r) => r.id === TOMATO_PASTA)!;
    const viaSession = await createSessionSummariser(async () => 'hh-z').summarise(recipe);
    const viaHousehold = await summariserForHousehold('hh-z').summarise(recipe);
    expect(viaHousehold).toEqual(viaSession);
    expect(viaHousehold.cost.totalPence).not.toBeNull();
  });
});
