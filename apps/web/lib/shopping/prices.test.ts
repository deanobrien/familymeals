import { describe, expect, it } from 'vitest';
import { applyCommand, defaultEngineContext, deriveAll, emptyState, type Command } from './engine';
import { estimateBasket } from './prices';

const ctx = defaultEngineContext;
const at = '2026-10-19T10:00:00.000Z';

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
  add('1', 'Chicken breast', 500, 'g', 'ing-chicken-breast'); // 650p/kg -> 325p
  add('2', 'Bananas', 5, 'item'); // 12p each -> 60p
  add('3', 'Mystery item', 1, 'item'); // unpriced
  return deriveAll(s, ctx);
}

describe('estimateBasket', () => {
  it('prices outstanding quantities with unit conversion and counts unpriced items', () => {
    const b = estimateBasket(withItems());
    expect(b.totalPence).toBe(325 + 60);
    expect(b.pricedCount).toBe(2);
    expect(b.unpricedCount).toBe(1);
    expect(b.weakestKind).toBe('generic_estimate');
  });

  it('shrinks as items are bought', () => {
    let s = emptyState();
    s = applyCommand(s, { type: 'add_item', commandId: 'a', actor: 'x', at, itemId: 'i', displayName: 'Bananas', category: 'Other', quantity: { kind: 'exact', value: 10, unit: 'item', originalText: '10' } }, ctx).state;
    s = applyCommand(s, { type: 'purchase', commandId: 'p', actor: 'x', at, itemId: 'i', quantity: { kind: 'exact', value: 4, unit: 'item', originalText: '4' } }, ctx).state;
    expect(estimateBasket(deriveAll(s, ctx)).totalPence).toBe(72);
    s = applyCommand(s, { type: 'tick', commandId: 't', actor: 'x', at, itemId: 'i' }, ctx).state;
    expect(estimateBasket(deriveAll(s, ctx)).totalPence).toBe(0);
  });
});
