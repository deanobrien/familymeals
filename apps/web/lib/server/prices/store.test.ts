import { describe, expect, it } from 'vitest';
import type { PriceObservation } from '@fr/domain';
import { getRecipeRepository } from '../../recipes/factory';
import { getGenericRecipeCalculator, getRecipeCalculator, resetRecipeCalculators } from '../calc';
import { InMemoryPriceStore, getPriceStore } from './store';

const kg = { kind: 'exact' as const, value: 1, unit: 'kg' as const, originalText: '1kg' };

describe('shared price store', () => {
  it('serves generic estimates plus only this household\'s observations', () => {
    const gen: PriceObservation = { ingredientId: 'x', pricePence: 100, packQuantity: kg, kind: 'generic_estimate', observedOn: '2026-10-01', source: 'g' };
    const s = new InMemoryPriceStore([gen]);
    const rec = { ...gen, pricePence: 80, kind: 'receipt' as const, source: 'receipt:1' };
    const v0 = s.asPriceSource('h1').version();
    s.record('h1', [rec]);
    expect(s.observationsFor('h1')).toEqual([gen, rec]);
    expect(s.observationsFor('h2')).toEqual([gen]);
    expect(s.asPriceSource('h1').observations()).toEqual([rec]); // generic excluded: the calculator adds its own
    expect(s.asPriceSource('h2').observations()).toEqual([]); // another household's receipt is invisible
    expect(s.asPriceSource('h1').version()).not.toBe(v0);
  });

  it('a price source has a per-household version, and a reset is a new epoch', () => {
    const s = new InMemoryPriceStore([]);
    const obs: PriceObservation = { ingredientId: 'x', pricePence: 1, packQuantity: kg, kind: 'receipt', observedOn: '2026-10-19', source: 'r' };
    const a0 = s.asPriceSource('a').version();
    const b0 = s.asPriceSource('b').version();
    s.record('a', [obs]);
    expect(s.asPriceSource('a').version()).not.toBe(a0);
    expect(s.asPriceSource('b').version()).toBe(b0); // b's cached costs stay valid
    s.reset();
    expect(s.asPriceSource('a').observations()).toEqual([]);
    expect(s.asPriceSource('a').version()).not.toBe(a0);
  });

  it('receipt prices beat generic estimates in the recipe cost calculator, for the household that recorded them only (D101)', async () => {
    const recipe = (await getRecipeRepository().get('00000000-0000-4000-8000-000000000001'))!; // tomato pasta
    const store = getPriceStore();
    store.reset();
    resetRecipeCalculators();
    const mine = getRecipeCalculator('household-mine');
    const theirs = getRecipeCalculator('household-theirs');
    const before = mine.forRecipe(recipe).cost;
    expect(theirs.forRecipe(recipe).cost.totalPence).toBe(before.totalPence);
    const line = recipe.ingredients.find((l) => l.ingredientId && l.quantity.unit === 'g')!;
    store.record('household-mine', [{ ingredientId: line.ingredientId!, pricePence: 1, packQuantity: kg, kind: 'receipt', observedOn: '2026-10-19', source: 'receipt:test' }]);
    const after = mine.forRecipe(recipe).cost;
    expect(after.totalPence).not.toBeNull();
    expect(after.totalPence!).toBeLessThan(before.totalPence!);
    // the other household's costs did not move, and neither did the generic fallback
    expect(theirs.forRecipe(recipe).cost.totalPence).toBe(before.totalPence);
    expect(getGenericRecipeCalculator().forRecipe(recipe).cost.totalPence).toBe(before.totalPence);
    store.reset();
    resetRecipeCalculators();
  });
});
