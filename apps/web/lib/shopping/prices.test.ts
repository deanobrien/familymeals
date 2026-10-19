import { describe, expect, it } from 'vitest';
import type { PriceObservation } from '@fr/domain';
import { applyCommand, defaultEngineContext, deriveAll, emptyState, type Command } from './engine';
import { estimateBasket, type PriceBook } from './prices';

const ctx = defaultEngineContext;
const at = '2026-10-19T10:00:00.000Z';
const CHICKEN = 'c0000000-0000-4000-8000-000000000001';
const BANANA = 'c0000000-0000-4000-8000-000000000002';

const obs = (ingredientId: string, pricePence: number, value: number, unit: 'kg' | 'item', kind: PriceObservation['kind'] = 'generic_estimate', observedOn = '2026-10-01'): PriceObservation => ({
  ingredientId, pricePence, packQuantity: { kind: 'exact', value, unit, originalText: `${value}${unit}` }, kind, observedOn, source: 'test',
});

const book = (extra: PriceObservation[] = []): PriceBook => ({
  observations: [obs(CHICKEN, 650, 1, 'kg'), obs(BANANA, 12, 1, 'item'), ...extra],
  ingredients: [
    { id: CHICKEN, name: 'chicken breast', category: 'meat_poultry', aliases: [] },
    { id: BANANA, name: 'banana', category: 'fruit_veg', aliases: [] },
  ],
  nameIndex: { 'name:bananas': BANANA },
});

function withItems(): ReturnType<typeof deriveAll> {
  let s = emptyState();
  const add = (itemId: string, name: string, value: number, unit: 'g' | 'item', ingredientId?: string) => {
    const cmd: Command = {
      type: 'add_item', commandId: `c-${itemId}`, actor: 'a', at, itemId, displayName: name, category: 'Other',
      quantity: { kind: 'exact', value, unit, originalText: `${value}` },
      ...(ingredientId ? { ingredientId } : {}),
    };
    s = applyCommand(s, cmd, ctx).state;
  };
  add('1', 'Chicken breast', 500, 'g', CHICKEN); // 650p/kg -> 325p
  add('2', 'Bananas', 5, 'item'); // by name, 12p each -> 60p
  add('3', 'Mystery item', 1, 'item'); // unpriced
  return deriveAll(s, ctx);
}

describe('estimateBasket (@fr/engine/cost)', () => {
  it('prices outstanding quantities with unit conversion and counts unpriced items', () => {
    const b = estimateBasket(withItems(), book());
    expect(b.totalPence).toBe(325 + 60);
    expect(b.pricedCount).toBe(2);
    expect(b.unpricedCount).toBe(1);
    expect(b.weakestKind).toBe('generic_estimate');
  });

  it('a receipt price beats the generic estimate', () => {
    const b = estimateBasket(withItems(), book([obs(CHICKEN, 500, 1, 'kg', 'receipt', '2026-09-01')]));
    expect(b.totalPence).toBe(250 + 60);
    expect(Object.values(b.byItem).map((c) => c.kind).sort()).toEqual(['generic_estimate', 'receipt']);
  });

  it('shrinks as items are bought', () => {
    let s = emptyState();
    s = applyCommand(s, { type: 'add_item', commandId: 'a', actor: 'x', at, itemId: 'i', displayName: 'Bananas', category: 'Other', quantity: { kind: 'exact', value: 10, unit: 'item', originalText: '10' } }, ctx).state;
    s = applyCommand(s, { type: 'purchase', commandId: 'p', actor: 'x', at, itemId: 'i', quantity: { kind: 'exact', value: 4, unit: 'item', originalText: '4' } }, ctx).state;
    expect(estimateBasket(deriveAll(s, ctx), book()).totalPence).toBe(72);
    s = applyCommand(s, { type: 'tick', commandId: 't', actor: 'x', at, itemId: 'i' }, ctx).state;
    expect(estimateBasket(deriveAll(s, ctx), book()).totalPence).toBe(0);
  });
});
