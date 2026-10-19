import { describe, expect, it } from 'vitest';
import { basicConverter, exactQ, makeCtx, deductRequirements, assessConfidence } from './engine';

describe('basicConverter', () => {
  it('converts within a dimension and refuses across dimensions', () => {
    expect(basicConverter.convert(exactQ(1.5, 'kg'), 'g')).toMatchObject({ value: 1500, unit: 'g' });
    expect(basicConverter.convert(exactQ(500, 'ml'), 'l')).toMatchObject({ value: 0.5, unit: 'l' });
    expect(basicConverter.convert(exactQ(100, 'g'), 'ml')).toBeNull();
    expect(basicConverter.convert(exactQ(2, 'item'), 'g')).toBeNull();
    expect(basicConverter.convert({ kind: 'to_taste', originalText: 'salt' }, 'g')).toBeNull();
  });
});

describe('engine wiring', () => {
  const now = '2026-10-19T12:00:00.000Z';
  it('makeCtx builds a policy and ids', () => {
    const ctx = makeCtx({ now, staleAfterDays: 3 });
    expect(ctx.policy.staleAfterDays).toBe(3);
    expect(ctx.newId()).not.toBe(ctx.newId());
  });
  it('deducts confident stock from requirements via the vendored engine', () => {
    const ctx = makeCtx({ now });
    const item = { id: 'i1', householdId: 'h', ingredientId: 'ing', name: 'flour', quantity: exactQ(1, 'kg'), lastUpdated: now, source: 'manual' as const };
    expect(assessConfidence(item, now, ctx.policy).status).toBe('confident');
    const res = deductRequirements([{ ingredientId: 'ing', displayName: 'flour', quantity: exactQ(400, 'g'), contributions: [] }], [item], ctx);
    expect(res.toBuy).toEqual([]);
  });
});
