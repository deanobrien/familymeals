import { describe, expect, it } from 'vitest';
import {
  NOT_PLACED_LABEL, normaliseItemKey, orderForStore, resolveAisle, suggestRouteOrder,
  type StoreAisle, type StorePlacement,
} from '../../src/shopping/store-order';
import { templateForChain } from '../../src/shopping/store-templates';

const S = 'store-aldi';
const L = 'store-lidl';
const aisle = (id: string, storeId: string, label: string, sortOrder: number): StoreAisle => ({ id, storeId, label, sortOrder });
const aisles: StoreAisle[] = [
  aisle('a5', S, '5', 50), aisle('a1', S, '1', 10), aisle('a3', S, '3', 30),
  aisle('l1', L, 'Frozen', 10), aisle('l2', L, 'Fruit', 20),
];
const place = (storeId: string, targetType: StorePlacement['targetType'], targetKey: string, aisleId: string): StorePlacement =>
  ({ storeId, targetType, targetKey, aisleId });
const v = (id: string, displayName: string, category = 'Other', ingredientId?: string) => ({ item: { id, displayName, category, ingredientId } });

const tomato = v('i1', 'Tomatoes', 'Fruit & veg', 'ing-tomato');
const milk = v('i2', 'Milk', 'Dairy & eggs', 'ing-milk');
const peas = v('i3', 'Frozen peas', 'Frozen', 'ing-peas');
const mystery = v('i4', 'Mystery sauce', 'Tins & jars');

describe('orderForStore', () => {
  const placements = [
    place(S, 'ingredient', 'ing-tomato', 'a1'), place(S, 'ingredient', 'ing-milk', 'a5'), place(S, 'category', 'Frozen', 'a3'),
    place(L, 'ingredient', 'ing-tomato', 'l2'), place(L, 'category', 'Frozen', 'l1'), place(L, 'ingredient', 'ing-milk', 'l1'),
  ];

  it('orders sections by aisle sortOrder with items inside, unknowns last in "Not placed yet"', () => {
    const out = orderForStore([mystery, milk, peas, tomato], { id: S }, aisles, placements);
    expect(out.map((s) => [s.label, s.items.map((x) => x.item.id)])).toEqual([
      ['1', ['i1']], ['3', ['i3']], ['5', ['i2']], [NOT_PLACED_LABEL, ['i4']],
    ]);
    expect(out.at(-1)).toMatchObject({ aisleId: null, placed: false });
    expect(out[0]).toMatchObject({ aisleId: 'a1', placed: true });
  });

  it('a different store gives a different order (placements are per store)', () => {
    const out = orderForStore([mystery, milk, peas, tomato], { id: L }, aisles, placements);
    expect(out.map((s) => [s.label, s.items.map((x) => x.item.id)])).toEqual([
      ['Frozen', ['i3', 'i2']], ['Fruit', ['i1']], [NOT_PLACED_LABEL, ['i4']],
    ]);
  });

  it('ingredient placement overrides category placement; item name beats category; category is the fallback', () => {
    const p = [place(S, 'category', 'Fruit & veg', 'a3'), place(S, 'ingredient', 'ing-tomato', 'a1'), place(S, 'item', 'mystery sauce', 'a5'), place(S, 'category', 'Tins & jars', 'a3')];
    expect(resolveAisle(tomato.item, S, aisles, p)?.id).toBe('a1');
    expect(resolveAisle(mystery.item, S, aisles, p)?.id).toBe('a5');
    expect(resolveAisle(v('x', 'Baked beans', 'Tins & jars').item, S, aisles, p)?.id).toBe('a3');
    expect(resolveAisle(v('y', 'Spuds', 'Fruit & veg').item, S, aisles, p)?.id).toBe('a3');
    expect(resolveAisle(v('z', 'Soap', 'Household').item, S, aisles, p)).toBeNull();
  });

  it('matches free-text items by normalised name (case, punctuation, spacing)', () => {
    expect(normaliseItemKey('  Heinz  Baked-Beans! ')).toBe('heinz baked beans');
    const p = [place(S, 'item', 'baked beans', 'a3')];
    expect(resolveAisle(v('x', 'BAKED  beans').item, S, aisles, p)?.id).toBe('a3');
  });

  it('ignores placements of other stores and placements that point at a deleted or foreign aisle', () => {
    const p = [place(L, 'ingredient', 'ing-tomato', 'l2'), place(S, 'ingredient', 'ing-milk', 'gone'), place(S, 'ingredient', 'ing-peas', 'l1')];
    const out = orderForStore([tomato, milk, peas], { id: S }, aisles, p);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ label: NOT_PLACED_LABEL });
    expect(out[0]!.items).toHaveLength(3);
  });

  it('is stable: name then id inside an aisle, independent of input order', () => {
    const a = v('b2', 'apple', 'Fruit & veg', 'ing-apple');
    const b = v('a1', 'Apple', 'Fruit & veg', 'ing-apple2');
    const c = v('c3', 'Banana', 'Fruit & veg', 'ing-banana');
    const p = [place(S, 'category', 'Fruit & veg', 'a1')];
    const one = orderForStore([c, a, b], { id: S }, aisles, p)[0]!.items.map((x) => x.item.id);
    const two = orderForStore([b, c, a], { id: S }, aisles, p)[0]!.items.map((x) => x.item.id);
    expect(one).toEqual(['a1', 'b2', 'c3']);
    expect(two).toEqual(one);
  });

  it('orders the unplaced section by list category order, then name', () => {
    const items = [v('1', 'Zebra cake', 'Bakery'), v('2', 'Beans', 'Tins & jars'), v('3', 'Anchovies', 'Tins & jars'), v('4', 'Odd thing', 'Weird')];
    const out = orderForStore(items, { id: S }, aisles, [], { categoryOrder: ['Bakery', 'Tins & jars'] });
    expect(out).toHaveLength(1);
    expect(out[0]!.items.map((x) => x.item.id)).toEqual(['1', '3', '2', '4']);
  });

  it('hides empty aisles unless asked, and handles an empty list and a store with no aisles', () => {
    expect(orderForStore([], { id: S }, aisles, [])).toEqual([]);
    expect(orderForStore([], { id: S }, aisles, [], { includeEmptyAisles: true }).map((s) => s.label)).toEqual(['1', '3', '5']);
    const out = orderForStore([tomato], { id: 'nostore' }, aisles, placements);
    expect(out.map((s) => s.label)).toEqual([NOT_PLACED_LABEL]);
  });

  it('keeps ticked items where the caller left them (it orders whatever it is given)', () => {
    const ticked = { ...tomato, status: 'complete' };
    const out = orderForStore([ticked, milk], { id: S }, aisles, placements);
    expect(out[0]!.items[0]).toBe(ticked);
  });

  it('does not mutate its inputs', () => {
    const a = [...aisles];
    const p = [...placements];
    const items = [mystery, tomato];
    orderForStore(items, { id: S }, a, p);
    expect(a).toEqual(aisles);
    expect(p).toEqual(placements);
    expect(items).toEqual([mystery, tomato]);
  });
});

describe('suggestRouteOrder (suggest only)', () => {
  const cur = ['a1', 'a2', 'a3', 'a4', 'a5'];
  it('needs evidence from at least three aisles', () => {
    expect(suggestRouteOrder(cur, [{ aisleId: 'a3' }, { aisleId: 'a1' }])).toMatchObject({ changed: false, order: cur });
  });
  it('reorders visited aisles into the slots they occupy, leaving unvisited aisles in place', () => {
    const r = suggestRouteOrder(cur, [{ aisleId: 'a3' }, { aisleId: 'a3' }, { aisleId: 'a1' }, { aisleId: 'a5' }]);
    expect(r.visited).toEqual(['a3', 'a1', 'a5']);
    expect(r.order).toEqual(['a3', 'a2', 'a1', 'a4', 'a5']);
    expect(r.changed).toBe(true);
  });
  it('reports no change when the route matches, and ignores unknown aisles', () => {
    const r = suggestRouteOrder(cur, [{ aisleId: 'a1' }, { aisleId: 'zz' }, { aisleId: 'a2' }, { aisleId: 'a4' }]);
    expect(r.changed).toBe(false);
    expect(r.visited).toEqual(['a1', 'a2', 'a4']);
  });
});

describe('templates', () => {
  it('pick a template per chain and are plain guesses (every list category is covered)', () => {
    expect(templateForChain('ALDI').id).toBe('discounter');
    expect(templateForChain('lidl').id).toBe('discounter');
    expect(templateForChain('Iceland').id).toBe('frozen_first');
    expect(templateForChain("Sainsbury's").id).toBe('generic');
    expect(templateForChain(null).id).toBe('generic');
    const cats = templateForChain('Tesco').aisles.flatMap((a) => a.categories);
    expect(new Set(cats)).toEqual(new Set(['Fruit & veg', 'Meat & fish', 'Dairy & eggs', 'Bakery', 'Tins & jars', 'Dry goods', 'Herbs & spices', 'Frozen', 'Drinks', 'Household']));
  });
});
