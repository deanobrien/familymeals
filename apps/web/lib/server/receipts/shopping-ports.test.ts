import { describe, expect, it } from 'vitest';
import type { PriceObservation } from '@fr/domain';
import { deriveAll } from '@fr/engine/shopping';
import { InMemoryPriceStore } from '../prices/store';
import { getIngredientCatalogue } from '../refdata/catalogue';
import { InMemoryShoppingRepository } from '../shopping/repository';
import { InMemoryPurchaseSink } from './memory';
import { ShoppingOutstandingSource, ShoppingPurchaseSink } from './shopping-ports';

const HH = 'hh-receipts';
const at = '2026-10-19T10:00:00.000Z';

async function setup() {
  const cat = getIngredientCatalogue();
  const ctx = { converter: cat.converter };
  const repo = new InMemoryShoppingRepository(ctx);
  const lentils = cat.matcher.match('red lentils');
  const onion = cat.matcher.match('onion');
  await repo.submit(HH, { type: 'add_item', commandId: 'c1', actor: 'u', at, itemId: 'i-lentils', displayName: 'Red lentils', category: 'Dry goods', ingredientId: lentils.ingredientId!, quantity: { kind: 'exact', value: 500, unit: 'g', originalText: '500 g' } });
  await repo.submit(HH, { type: 'add_item', commandId: 'c2', actor: 'u', at, itemId: 'i-onion', displayName: 'Onions', category: 'Fruit & veg', ingredientId: onion.ingredientId!, quantity: { kind: 'exact', value: 4, unit: 'item', originalText: '4' } });
  return { cat, ctx, repo, lentilsId: lentils.ingredientId!, onionId: onion.ingredientId! };
}

describe('receipts <-> shopping list', () => {
  it('outstanding items come from the shopping list with canonical names', async () => {
    const { cat, ctx, repo, lentilsId } = await setup();
    const items = await new ShoppingOutstandingSource(repo, ctx, cat.get).list(HH);
    expect(items.map((i) => i.shoppingListItemId).sort()).toEqual(['i-lentils', 'i-onion']);
    const l = items.find((i) => i.shoppingListItemId === 'i-lentils')!;
    expect(l).toMatchObject({ ingredientId: lentilsId, outstanding: { value: 500, unit: 'g' } });
  });

  it('an item with no canonical id is resolved by exact name so its receipt price can be recorded (LT1 D231)', async () => {
    const cat = getIngredientCatalogue();
    const ctx = { converter: cat.converter };
    const repo = new InMemoryShoppingRepository(ctx);
    await repo.submit(HH, { type: 'add_item', commandId: 'n1', actor: 'u', at, itemId: 'i-typed', displayName: 'Red lentils', category: 'Dry goods', quantity: { kind: 'exact', value: 500, unit: 'g', originalText: '500 g' } });
    await repo.submit(HH, { type: 'add_item', commandId: 'n2', actor: 'u', at, itemId: 'i-odd', displayName: 'Grandma special', category: 'Other', quantity: { kind: 'exact', value: 1, unit: 'item', originalText: '1' } });
    const resolve = (name: string) => { const m = cat.matcher.match(name); return m.status === 'matched' ? m.ingredientId : undefined; };
    const plain = await new ShoppingOutstandingSource(repo, ctx, cat.get).list(HH);
    expect(plain.find((i) => i.shoppingListItemId === 'i-typed')!.ingredientId).toBeUndefined();
    const items = await new ShoppingOutstandingSource(repo, ctx, cat.get, resolve).list(HH);
    expect(items.find((i) => i.shoppingListItemId === 'i-typed')!.ingredientId).toBe(cat.matcher.match('red lentils').ingredientId);
    expect(items.find((i) => i.shoppingListItemId === 'i-odd')!.ingredientId).toBeUndefined(); // no guessing
  });

  it('confirmed purchases tick items (incompatible units fall back to a tick) and record receipt prices', async () => {
    const { cat, ctx, repo, lentilsId } = await setup();
    const prices = new InMemoryPriceStore([]);
    const sink = new ShoppingPurchaseSink(HH, repo, prices, new InMemoryPurchaseSink());
    await sink.recordPurchases([
      { id: 'e1', shoppingListItemId: 'i-lentils', quantity: { kind: 'exact', value: 500, unit: 'g', originalText: '500G' }, actualPricePence: 110, createdBy: 'u', createdAt: at },
      { id: 'e2', shoppingListItemId: 'i-onion', quantity: { kind: 'exact', value: 1, unit: 'kg', originalText: '1KG' }, createdBy: 'u', createdAt: at },
    ]);
    const views = deriveAll((await repo.snapshot(HH)).state, ctx);
    expect(views.every((v) => v.outstanding === 0)).toBe(true);
    expect(await new ShoppingOutstandingSource(repo, ctx, cat.get).list(HH)).toEqual([]);

    const obs: PriceObservation = { ingredientId: lentilsId, pricePence: 110, packQuantity: { kind: 'exact', value: 500, unit: 'g', originalText: '500G' }, kind: 'receipt', observedOn: '2026-10-19', source: 'receipt:r:l' };
    await sink.recordPriceObservations([obs]);
    expect(prices.observationsFor(HH, [lentilsId])).toEqual([obs]);
    expect(prices.observationsFor('someone-else', [lentilsId])).toEqual([]);
  });
});
