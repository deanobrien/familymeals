import { describe, expect, it } from 'vitest';
import type { PriceObservation } from '@fr/domain';
import { getRecipeRepository } from '../../recipes/factory';
import { createRecipeCalculator } from '../calc';
import { InMemoryPriceStore, getPriceStore } from './store';

describe('shared price store', () => {
  it('serves generic estimates plus only this household\'s observations', () => {
    const gen: PriceObservation = { ingredientId: 'x', pricePence: 100, packQuantity: { kind: 'exact', value: 1, unit: 'kg', originalText: '1kg' }, kind: 'generic_estimate', observedOn: '2026-10-01', source: 'g' };
    const s = new InMemoryPriceStore([gen]);
    const rec = { ...gen, pricePence: 80, kind: 'receipt' as const, source: 'receipt:1' };
    const v0 = s.asPriceSource().version();
    s.record('h1', [rec]);
    expect(s.observationsFor('h1')).toEqual([gen, rec]);
    expect(s.observationsFor('h2')).toEqual([gen]);
    expect(s.asPriceSource().observations()).toEqual([rec]); // generic excluded: the calculator adds its own
    expect(s.asPriceSource().version()).not.toBe(v0);
  });

  it('receipt prices from the store beat generic estimates in the recipe cost calculator', async () => {
    const recipe = (await getRecipeRepository().get('00000000-0000-4000-8000-000000000001'))!; // tomato pasta
    const store = getPriceStore();
    store.reset();
    const calc = createRecipeCalculator({ priceSource: store.asPriceSource() });
    const before = calc.forRecipe(recipe).cost;
    const line = recipe.ingredients.find((l) => l.ingredientId && l.quantity.unit === 'g')!;
    store.record('any', [{ ingredientId: line.ingredientId!, pricePence: 1, packQuantity: { kind: 'exact', value: 1, unit: 'kg', originalText: '1kg' }, kind: 'receipt', observedOn: '2026-10-19', source: 'receipt:test' }]);
    const after = calc.forRecipe(recipe).cost;
    expect(after.totalPence).not.toBeNull();
    expect(after.totalPence!).toBeLessThan(before.totalPence!);
    store.reset();
  });
});
