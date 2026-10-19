import { describe, expect, it } from 'vitest';
import type { Requirement } from '../../src/contract';
import { consumeCookedMeal, deductRequirements } from '../../src/pantry';
import { item, mkCtx, q } from './helpers';

const req = (ingredientId: string | undefined, quantity = q(200, 'g'), displayName = ingredientId ?? 'mystery'): Requirement =>
  ({ ingredientId, displayName, quantity, contributions: [] });

describe('requirement deduction', () => {
  it('deducts convertible confident stock and reports why', () => {
    const pantry = [item({ id: 'r', name: 'Rice', ingredientId: 'rice', quantity: q(0.15, 'kg') })];
    const res = deductRequirements([req('rice', q(200, 'g'), 'Rice')], pantry, mkCtx());
    expect(res.toBuy[0]!.quantity.value).toBe(50);
    expect(res.lines[0]!.deducted.value).toBe(150);
    expect(res.lines[0]!.explanation).toContain('from "Rice"');
    expect(res.lines[0]!.explanation).toContain('still need 50 g');
  });

  it('fully covered requirement disappears from toBuy', () => {
    const pantry = [item({ id: 'r', ingredientId: 'rice', quantity: q(1, 'kg') })];
    const res = deductRequirements([req('rice')], pantry, mkCtx());
    expect(res.toBuy).toEqual([]);
    expect(res.lines[0]!.explanation).toContain('fully covered');
  });

  it('skips stale and expired stock, and says so; flag opts stale back in with a warning', () => {
    const pantry = [
      item({ id: 'stale', ingredientId: 'rice', quantity: q(500, 'g'), lastUpdated: '2026-01-01T00:00:00.000Z' }),
      item({ id: 'exp', ingredientId: 'rice', quantity: q(500, 'g'), expiry: '2026-10-01' }),
    ];
    const strict = deductRequirements([req('rice')], pantry, mkCtx());
    expect(strict.toBuy[0]!.quantity.value).toBe(200);
    expect(strict.lines[0]!.skipped.map((s) => s.reason)).toEqual([expect.stringContaining('stale — please confirm'), expect.stringContaining('expired')]);
    const lenient = deductRequirements([req('rice')], pantry, mkCtx(), { allowStale: true });
    expect(lenient.toBuy).toEqual([]);
    expect(lenient.lines[0]!.used[0]!.flag).toContain('stale');
  });

  it('never deducts approximate stock unless allowed; unconvertible units are skipped', () => {
    const pantry = [
      item({ id: 'a', ingredientId: 'rice', quantity: { kind: 'approximate', value: 300, unit: 'g', originalText: 'about 300g' } }),
      item({ id: 'b', ingredientId: 'rice', quantity: q(2, 'pack') }),
    ];
    const r = deductRequirements([req('rice')], pantry, mkCtx());
    expect(r.toBuy[0]!.quantity.value).toBe(200);
    expect(r.lines[0]!.skipped).toHaveLength(2);
    const r2 = deductRequirements([req('rice')], pantry, mkCtx(), { allowApproximate: true });
    expect(r2.toBuy).toEqual([]);
    expect(r2.lines[0]!.used[0]!.flag).toContain('approximate');
  });

  it('uses density for volume->mass only when the converter allows it', () => {
    const pantry = [item({ id: 'm', ingredientId: 'milk', quantity: q(1, 'l') })];
    const ok = deductRequirements([req('milk', q(515, 'g'))], pantry, mkCtx());
    expect(ok.lines[0]!.deducted.value).toBeCloseTo(515, 3);
    const noDensity = [item({ id: 'f', ingredientId: 'flour', quantity: q(1, 'l') })];
    expect(deductRequirements([req('flour')], noDensity, mkCtx()).toBuy[0]!.quantity.value).toBe(200);
  });

  it('leaves non-exact, unmatched requirements untouched and does not double-count stock', () => {
    const pantry = [item({ id: 'r', ingredientId: 'rice', quantity: q(300, 'g') })];
    const reqs = [req('rice'), req('rice'), req('salt', { kind: 'to_taste', originalText: 'to taste' }), req(undefined)];
    const res = deductRequirements(reqs, pantry, mkCtx());
    expect(res.lines[0]!.deducted.value).toBe(200);
    expect(res.lines[1]!.deducted.value).toBe(100);
    expect(res.toBuy.map((r) => r.displayName)).toEqual(['rice', 'salt', 'mystery']);
    expect(pantry[0]!.quantity.value).toBe(300); // pure
  });

  it('uses soonest-expiring stock first', () => {
    const pantry = [
      item({ id: 'late', ingredientId: 'rice', quantity: q(200, 'g'), expiry: '2027-01-01' }),
      item({ id: 'soon', ingredientId: 'rice', quantity: q(100, 'g'), expiry: '2026-10-21' }),
    ];
    const res = deductRequirements([req('rice', q(150, 'g'))], pantry, mkCtx());
    expect(res.lines[0]!.used.map((u) => [u.itemId, u.took])).toEqual([['soon', 100], ['late', 50]]);
  });
});

describe('consume cooked meal', () => {
  it('reduces stock, removes emptied items, reports shortfalls, never negative', () => {
    const pantry = [
      item({ id: 'o', ingredientId: 'onion', quantity: q(2, 'item') }),
      item({ id: 'r', ingredientId: 'rice', quantity: q(300, 'g') }),
    ];
    const res = consumeCookedMeal(pantry, [
      { ingredientId: 'onion', quantity: q(2, 'item') },
      { ingredientId: 'rice', quantity: q(0.5, 'kg') },
      { ingredientId: 'salt', quantity: { kind: 'to_taste', originalText: 'to taste' } },
    ], mkCtx());
    expect(res.items).toEqual([]);
    expect(res.shortfalls).toHaveLength(1);
    expect(res.shortfalls[0]!.quantity.value).toBe(0.2);
    expect(res.lines[2]!.explanation).toContain('not deducted');
  });

  it('partial consumption leaves remainder in stock unit', () => {
    const pantry = [item({ id: 'r', ingredientId: 'rice', quantity: q(1, 'kg') })];
    const res = consumeCookedMeal(pantry, [{ ingredientId: 'rice', quantity: q(250, 'g') }], mkCtx());
    expect(res.items[0]!.quantity).toMatchObject({ value: 0.75, unit: 'kg' });
  });

  it('does not consume stale stock without the flag', () => {
    const pantry = [item({ id: 'r', ingredientId: 'rice', quantity: q(1, 'kg'), lastUpdated: '2026-01-01T00:00:00.000Z' })];
    const res = consumeCookedMeal(pantry, [{ ingredientId: 'rice', quantity: q(250, 'g') }], mkCtx());
    expect(res.items).toEqual(pantry);
    expect(res.shortfalls).toHaveLength(1);
  });
});
