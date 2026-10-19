import { describe, expect, it } from 'vitest';
import { addStock, confirmStock, correctStock, staleItems, assessConfidence } from '../../src/pantry';
import { item, mkCtx, q } from './helpers';

describe('ledger', () => {
  it('merges convertible adds into confident stock and refreshes lastUpdated', () => {
    const ctx = mkCtx();
    const out = addStock([item({ id: 'a', ingredientId: 'rice', quantity: q(500, 'g') })],
      { householdId: 'h1', ingredientId: 'rice', name: 'Rice', quantity: q(1, 'kg') }, ctx);
    expect(out).toHaveLength(1);
    expect(out[0]!.quantity.value).toBe(1500);
    expect(out[0]!.lastUpdated).toBe(ctx.now);
  });

  it('does not merge into stale stock (age not laundered)', () => {
    const old = item({ id: 'a', ingredientId: 'rice', quantity: q(500, 'g'), lastUpdated: '2026-01-01T00:00:00.000Z' });
    const out = addStock([old], { householdId: 'h1', ingredientId: 'rice', name: 'Rice', quantity: q(1, 'kg') }, mkCtx());
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual(old);
  });

  it('keeps separate items for different expiry or unconvertible units', () => {
    const base = [item({ id: 'a', ingredientId: 'x', quantity: q(1, 'pack'), expiry: '2026-10-25' })];
    expect(addStock(base, { householdId: 'h1', ingredientId: 'x', name: 'X', quantity: q(1, 'pack'), expiry: '2026-10-30' }, mkCtx())).toHaveLength(2);
    expect(addStock(base, { householdId: 'h1', ingredientId: 'x', name: 'X', quantity: q(100, 'g'), expiry: '2026-10-25' }, mkCtx())).toHaveLength(2);
  });

  it('flags untouched stock as stale, with per-ingredient override', () => {
    const ctx = mkCtx({ policy: { staleAfterDays: 30, perIngredient: { spinach: 3 } } });
    const flour = item({ id: 'f', ingredientId: 'flour', lastUpdated: '2026-09-25T00:00:00.000Z' }); // 24d
    const spinach = item({ id: 's', ingredientId: 'spinach', lastUpdated: '2026-10-10T00:00:00.000Z' }); // 9d
    const ancient = item({ id: 'o', ingredientId: 'oil', lastUpdated: '2026-06-01T00:00:00.000Z' });
    expect(assessConfidence(flour, ctx.now, ctx.policy).status).toBe('confident');
    const c = assessConfidence(spinach, ctx.now, ctx.policy);
    expect(c.status).toBe('stale');
    expect(c.message).toContain('stale — please confirm');
    expect(staleItems([flour, spinach, ancient], ctx).map((i) => i.id)).toEqual(['s', 'o']);
  });

  it('manual correction resets confidence; zero removes; confirm keeps quantity', () => {
    const ctx = mkCtx();
    const old = item({ id: 'a', ingredientId: 'rice', quantity: q(500, 'g'), lastUpdated: '2026-01-01T00:00:00.000Z' });
    const fixed = correctStock([old], 'a', q(200, 'g'), ctx);
    expect(fixed[0]!.quantity.value).toBe(200);
    expect(fixed[0]!.source).toBe('correction');
    expect(assessConfidence(fixed[0]!, ctx.now, ctx.policy).status).toBe('confident');
    expect(correctStock([old], 'a', q(0, 'g'), ctx)).toEqual([]);
    const conf = confirmStock([old], 'a', ctx);
    expect(conf[0]!.quantity.value).toBe(500);
    expect(conf[0]!.lastUpdated).toBe(ctx.now);
  });

  it('treats approximate stock as approximate, expired as expired', () => {
    const ctx = mkCtx();
    const approx = item({ id: 'a', quantity: { kind: 'approximate', originalText: 'some' } });
    expect(assessConfidence(approx, ctx.now, ctx.policy).status).toBe('approximate');
    expect(assessConfidence(item({ id: 'b', expiry: '2026-10-18' }), ctx.now, ctx.policy).status).toBe('expired');
  });
});
