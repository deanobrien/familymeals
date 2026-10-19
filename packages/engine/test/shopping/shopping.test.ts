import { describe, expect, it } from 'vitest';
import { applyCommand } from '../../src/shopping/commands';
import { activeView, deriveAll, deriveItem, groupByAisle } from '../../src/shopping/derive';
import { type Command, type ShoppingState, emptyState } from '../../src/shopping/model';
import { T, ctx, q, req } from './helpers';

const A = 'user-a';
const B = 'user-b';

function run(state: ShoppingState, ...cmds: Command[]) {
  let s = state;
  const results = [];
  for (const c of cmds) {
    const o = applyCommand(s, c, ctx);
    s = o.state;
    results.push(o.result);
  }
  return { s, results };
}

const plan = (lines: Array<[string, ReturnType<typeof req>, string?, string?]>, commandId = 'regen-1'): Command => ({
  type: 'regenerate', commandId, actor: A, at: T,
  lines: lines.map(([itemId, requirement, category, aisle]) => ({ itemId, requirement, category: category ?? 'Other', ...(aisle ? { aisle } : {}) })),
});

const base = () => run(emptyState(), plan([
  ['i-flour', req('ing-flour', 'Flour', q(500, 'g')), 'Baking', 'Aisle 3'],
  ['i-milk', req('ing-milk', 'Milk', q(1, 'l')), 'Dairy', 'Aisle 1'],
  ['i-onion', req('ing-onion', 'Onion', q(3)), 'Veg', 'Aisle 2'],
  ['i-salt', req('ing-salt', 'Salt', { kind: 'to_taste', originalText: 'salt to taste' }), 'Baking', 'Aisle 3'],
])).s;

const view = (s: ShoppingState, id: string) => deriveItem(s, s.items[id]!, ctx);

describe('derived purchase state', () => {
  it('starts outstanding', () => {
    const v = view(base(), 'i-flour');
    expect(v).toMatchObject({ required: 500, purchased: 0, outstanding: 500, status: 'outstanding', unit: 'g' });
  });

  it('partial then complete with unit conversion (kg/g, ml/l)', () => {
    const { s, results } = run(base(),
      { type: 'purchase', commandId: 'e1', actor: A, at: T, itemId: 'i-flour', quantity: q(0.2, 'kg') },
      { type: 'purchase', commandId: 'e2', actor: A, at: T, itemId: 'i-milk', quantity: q(500, 'ml') },
    );
    expect(results.every((r) => r.status === 'applied')).toBe(true);
    expect(view(s, 'i-flour')).toMatchObject({ purchased: 200, outstanding: 300, status: 'partial' });
    expect(view(s, 'i-milk')).toMatchObject({ purchased: 0.5, outstanding: 0.5, status: 'partial' });
    const s2 = run(s, { type: 'purchase', commandId: 'e3', actor: B, at: T, itemId: 'i-flour', quantity: q(300, 'g') }).s;
    expect(view(s2, 'i-flour').status).toBe('complete');
  });

  it('over-purchase is allowed via explicit purchase and flagged', () => {
    const s = run(base(), { type: 'purchase', commandId: 'e1', actor: A, at: T, itemId: 'i-flour', quantity: q(1.5, 'kg') }).s;
    expect(view(s, 'i-flour')).toMatchObject({ purchased: 1500, outstanding: 0, status: 'over_purchased' });
  });

  it('converts count<->mass via unit weight and rejects incompatible units', () => {
    const { s, results } = run(base(),
      { type: 'purchase', commandId: 'e1', actor: A, at: T, itemId: 'i-onion', quantity: q(300, 'g') },
      { type: 'purchase', commandId: 'e2', actor: A, at: T, itemId: 'i-flour', quantity: q(2, 'cup') },
      { type: 'purchase', commandId: 'e3', actor: A, at: T, itemId: 'i-flour', quantity: q(0, 'g') },
    );
    expect(view(s, 'i-onion')).toMatchObject({ purchased: 2, outstanding: 1, status: 'partial' });
    expect(results[1]).toMatchObject({ status: 'rejected', reason: 'incompatible_unit' });
    expect(results[2]).toMatchObject({ status: 'rejected', reason: 'invalid_quantity' });
  });

  it('range requirement uses the upper bound', () => {
    const s = run(emptyState(), plan([['i-o', req('ing-onion', 'Onion', { kind: 'range', min: 2, max: 3, originalText: '2-3 onions' })]])).s;
    expect(view(s, 'i-o')).toMatchObject({ required: 3, status: 'outstanding' });
  });

  it('to_taste items are binary', () => {
    const { s, results } = run(base(),
      { type: 'tick', commandId: 'e1', actor: A, at: T, itemId: 'i-salt' },
      { type: 'tick', commandId: 'e2', actor: B, at: T, itemId: 'i-salt' },
    );
    expect(view(s, 'i-salt')).toMatchObject({ quantified: false, status: 'complete' });
    expect(results[1]).toMatchObject({ status: 'rejected', reason: 'already_complete', completedBy: [A] });
  });
});

describe('tick / undo / idempotency', () => {
  it('tick buys exactly the outstanding quantity', () => {
    const s0 = run(base(), { type: 'purchase', commandId: 'e1', actor: A, at: T, itemId: 'i-flour', quantity: q(100, 'g') }).s;
    const { s, results } = run(s0, { type: 'tick', commandId: 'e2', actor: B, at: T, itemId: 'i-flour' });
    expect(results[0]).toMatchObject({ status: 'applied', eventId: 'e2' });
    expect(s.events['e2']!.quantity).toMatchObject({ kind: 'exact', value: 400, unit: 'g' });
    expect(view(s, 'i-flour').status).toBe('complete');
  });

  it('second tick on a complete item is rejected (no double purchase)', () => {
    const { s, results } = run(base(),
      { type: 'tick', commandId: 'e1', actor: A, at: T, itemId: 'i-flour' },
      { type: 'tick', commandId: 'e2', actor: B, at: T, itemId: 'i-flour' },
    );
    expect(results[1]).toMatchObject({ status: 'rejected', reason: 'already_complete', completedBy: [A] });
    expect(view(s, 'i-flour')).toMatchObject({ purchased: 500, status: 'complete' });
    expect(s.events['e2']).toBeUndefined();
  });

  it('applying the same event id twice is a no-op', () => {
    const tick: Command = { type: 'tick', commandId: 'e1', actor: A, at: T, itemId: 'i-flour' };
    const s1 = run(base(), tick).s;
    const o = applyCommand(s1, tick, ctx);
    expect(o.state).toBe(s1);
    expect(o.result).toMatchObject({ status: 'applied', duplicate: true });
  });

  it('undo voids (never deletes) and re-opens the item; voided events excluded', () => {
    const { s, results } = run(base(),
      { type: 'tick', commandId: 'e1', actor: A, at: T, itemId: 'i-flour' },
      { type: 'undo', commandId: 'v1', actor: A, at: T, eventId: 'e1' },
      { type: 'undo', commandId: 'v2', actor: B, at: T, eventId: 'e1' },
      { type: 'undo', commandId: 'v3', actor: B, at: T, eventId: 'nope' },
    );
    expect(s.events['e1']).toMatchObject({ voidedBy: A });
    expect(s.voids['v1']).toMatchObject({ eventId: 'e1', by: A });
    const v = view(s, 'i-flour');
    expect(v).toMatchObject({ purchased: 0, status: 'outstanding' });
    expect(v.voidedEvents.map((e) => e.id)).toEqual(['e1']);
    expect(results[2]).toMatchObject({ status: 'rejected', reason: 'already_voided' });
    expect(results[3]).toMatchObject({ status: 'rejected', reason: 'event_not_found' });
    // a rejected tick stays rejected even after the winning tick is undone (no auto re-apply)
    const t = run(base(),
      { type: 'tick', commandId: 'e1', actor: A, at: T, itemId: 'i-flour' },
      { type: 'tick', commandId: 'e2', actor: B, at: T, itemId: 'i-flour' },
      { type: 'undo', commandId: 'v1', actor: A, at: T, eventId: 'e1' },
      { type: 'tick', commandId: 'e2', actor: B, at: T, itemId: 'i-flour' },
    );
    expect(t.results[3]).toMatchObject({ status: 'rejected', duplicate: true });
  });
});

describe('manual items', () => {
  it('add, merge same key, edit, remove (soft)', () => {
    const { s, results } = run(base(),
      { type: 'add_item', commandId: 'c1', actor: A, at: T, itemId: 'm-bin', displayName: 'Bin bags', category: 'Household', quantity: q(1, 'pack') },
      { type: 'add_item', commandId: 'c2', actor: B, at: T, itemId: 'm-flour', displayName: 'flour', ingredientId: 'ing-flour', category: 'Baking', quantity: q(0.25, 'kg') },
      { type: 'add_item', commandId: 'c3', actor: B, at: T, itemId: 'm-bin', displayName: 'x', category: 'x' },
    );
    expect(results[1]).toMatchObject({ status: 'applied', itemId: 'i-flour' }); // merged into plan item
    expect(view(s, 'i-flour')).toMatchObject({ required: 750 });
    expect(results[2]).toMatchObject({ status: 'rejected', reason: 'id_collision' });
    const s2 = run(s,
      { type: 'edit_item', commandId: 'c4', actor: A, at: T, itemId: 'm-bin', patch: { manualQuantity: q(2, 'pack'), notes: 'large' } },
    ).s;
    expect(view(s2, 'm-bin')).toMatchObject({ required: 2, unit: 'pack' });
    expect(s2.items['m-bin']!.notes).toBe('large');
    const { s: s3, results: r3 } = run(s2,
      { type: 'tick', commandId: 'e1', actor: A, at: T, itemId: 'm-bin' },
      { type: 'remove_item', commandId: 'c5', actor: A, at: T, itemId: 'm-bin' },
      { type: 'tick', commandId: 'e2', actor: A, at: T, itemId: 'm-bin' },
    );
    expect(s3.items['m-bin']!.removed).toMatchObject({ reason: 'user' });
    expect(s3.events['e1']).toBeDefined(); // purchase history preserved
    expect(view(s3, 'm-bin').noLongerNeeded).toBe(true);
    expect(r3[2]).toMatchObject({ status: 'rejected', reason: 'item_removed' });
  });
});

describe('regenerate', () => {
  it('requirement change keeps purchase history', () => {
    const s0 = run(base(), { type: 'tick', commandId: 'e1', actor: A, at: T, itemId: 'i-flour' }).s;
    const s1 = run(s0, plan([
      ['new-flour', req('ing-flour', 'Flour', q(800, 'g'))],
      ['new-milk', req('ing-milk', 'Milk', q(1, 'l'))],
      ['new-onion', req('ing-onion', 'Onion', q(3))],
      ['new-salt', req('ing-salt', 'Salt', { kind: 'to_taste', originalText: 'salt' })],
    ], 'regen-2')).s;
    expect(s1.items['new-flour']).toBeUndefined();
    expect(view(s1, 'i-flour')).toMatchObject({ required: 800, purchased: 500, outstanding: 300, status: 'partial' });
    expect(s1.items['i-flour']!.aisle).toBe('Aisle 3'); // user/category data kept
  });

  it('removed requirement: with purchases -> purchased, no longer needed; without -> soft removed; revived later', () => {
    const s0 = run(base(), { type: 'purchase', commandId: 'e1', actor: A, at: T, itemId: 'i-milk', quantity: q(1, 'l') }).s;
    const s1 = run(s0, plan([['x', req('ing-salt', 'Salt', { kind: 'to_taste', originalText: 'salt' })]], 'regen-2')).s;
    const milk = view(s1, 'i-milk');
    expect(milk).toMatchObject({ noLongerNeeded: true, purchased: 1, status: 'over_purchased' });
    expect(s1.items['i-milk']!.removed).toBeUndefined();
    expect(s1.items['i-flour']!.removed).toMatchObject({ reason: 'plan' });
    expect(activeView(s1, ctx).map((v) => v.item.id)).toEqual(['i-salt']);
    const s2 = run(s1, plan([['y', req('ing-flour', 'Flour', q(100, 'g'))]], 'regen-3')).s;
    expect(s2.items['i-flour']!.removed).toBeUndefined();
    expect(s2.items['y']).toBeUndefined();
    expect(view(s2, 'i-flour')).toMatchObject({ required: 100, status: 'outstanding' });
  });

  it('user-removed items stay removed on regenerate; manual quantity survives plan removal', () => {
    const s0 = run(base(),
      { type: 'remove_item', commandId: 'c1', actor: A, at: T, itemId: 'i-onion' },
      { type: 'edit_item', commandId: 'c2', actor: A, at: T, itemId: 'i-milk', patch: { manualQuantity: q(500, 'ml') } },
    ).s;
    expect(view(s0, 'i-milk').required).toBe(1.5);
    const s1 = run(s0, plan([['z', req('ing-onion', 'Onion', q(5))]], 'regen-2')).s;
    expect(s1.items['i-onion']!.removed).toMatchObject({ reason: 'user' });
    expect(s1.items['i-onion']!.requirement?.quantity.value).toBe(5);
    expect(view(s1, 'i-milk')).toMatchObject({ required: 500, unit: 'ml', noLongerNeeded: false });
  });
});

describe('grouping and active view', () => {
  it('groups by aisle with custom order and hides complete items', () => {
    const s = run(base(), { type: 'tick', commandId: 'e1', actor: A, at: T, itemId: 'i-milk' }).s;
    const groups = groupByAisle(activeView(s, ctx), ['Aisle 3', 'Aisle 2']);
    expect(groups.map((g) => [g.group, g.items.map((v) => v.item.displayName)])).toEqual([
      ['Aisle 3', ['Flour', 'Salt']],
      ['Aisle 2', ['Onion']],
    ]);
    expect(activeView(s, ctx, { includeComplete: true })).toHaveLength(4);
    expect(deriveAll(s, ctx)).toHaveLength(4);
  });
});
