import { describe, expect, it } from 'vitest';
import { expiringSoon, planLeftovers, rankRecipesByPantry, urgencyOf } from '../../src/pantry';
import { item, mkCtx, NOW, q } from './helpers';

describe('expiry', () => {
  it('lists expired and soon-expiring items in order, ignoring far/none', () => {
    const items = [
      item({ id: 'far', expiry: '2026-12-01' }), item({ id: 'none' }),
      item({ id: 'soon', expiry: '2026-10-21' }), item({ id: 'old', expiry: '2026-10-17' }), item({ id: 'today', expiry: '2026-10-19' }),
    ];
    const r = expiringSoon(items, NOW, 3);
    expect(r.map((e) => [e.item.id, e.daysLeft, e.expired])).toEqual([['old', -2, true], ['today', 0, false], ['soon', 2, false]]);
  });
});

describe('leftovers', () => {
  const slots = [
    { id: 's1', date: '2026-10-20', mealType: 'dinner' as const }, { id: 's2', date: '2026-10-20', mealType: 'lunch' as const },
    { id: 's3', date: '2026-10-21', mealType: 'snack' as const }, { id: 's4', date: '2026-10-22', mealType: 'dinner' as const },
    { id: 's5', date: '2026-10-30', mealType: 'dinner' as const },
  ];
  it('places remaining portions in earliest eligible slots before use-by', () => {
    const p = planLeftovers({ recipeId: 'r', recipeTitle: 'Chilli', cookedOn: '2026-10-19', portionsCooked: 6, portionsEaten: 3 }, slots);
    expect(p.portionsRemaining).toBe(3);
    expect(p.useByDate).toBe('2026-10-22');
    expect(p.suggestions.map((s) => s.slotId)).toEqual(['s2', 's1', 's4']);
    expect(p.unplaced).toBe(0);
  });
  it('advises freezing (or eating sooner) for unplaced portions', () => {
    const base = { recipeId: 'r', cookedOn: '2026-10-19', portionsCooked: 8, portionsEaten: 2 };
    const frz = planLeftovers({ ...base, freezable: true }, slots);
    expect(frz.unplaced).toBe(3);
    expect(frz.advice[0]).toContain('freeze');
    expect(planLeftovers(base, slots).advice[0]).toContain('not marked freezable');
  });
  it('supports multiple portions per slot', () => {
    const p = planLeftovers({ recipeId: 'r', cookedOn: '2026-10-19', portionsCooked: 4, portionsEaten: 0 }, slots, 2);
    expect(p.suggestions.map((s) => s.portions)).toEqual([2, 2]);
  });
});

describe('use what I have', () => {
  const ctx = mkCtx();
  const pantry = [
    item({ id: 'p1', name: 'Chicken', ingredientId: 'chicken', quantity: q(500, 'g'), expiry: '2026-10-20' }),
    item({ id: 'p2', name: 'Rice', ingredientId: 'rice', quantity: q(1, 'kg') }),
    item({ id: 'p3', name: 'Lentils', ingredientId: 'lentils', quantity: q(500, 'g'), lastUpdated: '2026-01-01T00:00:00.000Z' }),
    item({ id: 'p4', name: 'Old milk', ingredientId: 'milk', quantity: q(1, 'l'), expiry: '2026-10-10' }),
  ];
  const recipes = [
    { id: 'curry', title: 'Chicken rice', lines: [
      { ingredientId: 'chicken', quantity: q(400, 'g') }, { ingredientId: 'rice', quantity: q(200, 'g') },
      { ingredientId: 'salt', quantity: { kind: 'to_taste' as const, originalText: 'to taste' } }, { ingredientId: 'saffron', quantity: q(1, 'g'), optional: true }] },
    { id: 'dal', title: 'Dal', lines: [{ ingredientId: 'lentils', quantity: q(200, 'g') }, { ingredientId: 'rice', quantity: q(200, 'g') }] },
    { id: 'custard', title: 'Custard', lines: [{ ingredientId: 'milk', quantity: q(500, 'ml') }] },
    { id: 'empty', title: 'Nothing', lines: [] },
  ];

  it('urgencyOf scales and ignores expired/no expiry', () => {
    expect(urgencyOf('2026-10-19', NOW, 5)).toBe(1);
    expect(urgencyOf('2026-10-21', NOW, 5)).toBe(0.6);
    expect(urgencyOf('2026-10-30', NOW, 5)).toBe(0);
    expect(urgencyOf('2026-10-01', NOW, 5)).toBe(0);
    expect(urgencyOf(undefined, NOW, 5)).toBe(0);
  });

  it('ranks by coverage with expiry boost; stale/expired stock not counted but explained', () => {
    const r = rankRecipesByPantry(recipes, pantry, ctx);
    expect(r.map((x) => x.recipeId)).toEqual(['curry', 'dal', 'custard', 'empty']);
    const curry = r[0]!;
    expect(curry.coverage).toBeCloseTo(2 / 3, 5); // chicken+rice covered, salt missing (not in pantry)
    expect(curry.urgency).toBeGreaterThan(0);
    expect(curry.explanations.join(' ')).toContain('chicken: in pantry and expiring soon');
    const dal = r[1]!;
    expect(dal.coverage).toBe(0.5);
    expect(dal.explanations.join(' ')).toContain('lentils: pantry stock is stale — please confirm');
    expect(r[2]!.score).toBe(0); // expired milk unusable
    expect(r[3]!.explanations[0]).toContain('no scoreable');
  });

  it('expiring ingredient outranks equal-coverage recipe without urgency', () => {
    const a = { id: 'a', title: 'A', lines: [{ ingredientId: 'chicken', quantity: q(100, 'g') }] };
    const b = { id: 'b', title: 'B', lines: [{ ingredientId: 'rice', quantity: q(100, 'g') }] };
    const r = rankRecipesByPantry([b, a], pantry, ctx);
    expect(r.map((x) => x.recipeId)).toEqual(['a', 'b']);
  });

  it('partial coverage is proportional and deterministic', () => {
    const r1 = rankRecipesByPantry([{ id: 'x', title: 'X', lines: [{ ingredientId: 'rice', quantity: q(2, 'kg') }] }], pantry, ctx);
    expect(r1[0]!.coverage).toBe(0.5);
    expect(r1[0]!.explanations.join(' ')).toContain('partly covered');
    expect(rankRecipesByPantry(recipes, pantry, ctx)).toEqual(rankRecipesByPantry(recipes, pantry, ctx));
  });
});
