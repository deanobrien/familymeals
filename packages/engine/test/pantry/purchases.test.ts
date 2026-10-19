import { describe, expect, it } from 'vitest';
import type { PurchaseEvent } from '../../src/contract';
import { applyAdjustments, planPurchaseAdjustments } from '../../src/pantry';
import { mkCtx, q } from './helpers';

const ev = (id: string, over: Partial<PurchaseEvent> = {}): PurchaseEvent => ({
  id, shoppingListItemId: 'sli-' + id, quantity: q(1, 'kg'), createdBy: 'u1', createdAt: '2026-10-19T08:00:00.000Z', ...over,
});
const resolve = (id: string) => (id === 'sli-ghost' ? undefined : { ingredientId: id === 'sli-vague' ? undefined : 'rice', name: 'Rice', householdId: 'h1' });

describe('purchase -> pantry', () => {
  it('off: nothing adjusted', () => {
    const r = planPurchaseAdjustments([ev('e1')], 'off', resolve);
    expect(r.adjustments).toEqual([]);
    expect(r.ignored[0]!.reason).toMatch(/off/);
  });

  it('suggest: all adjustments require confirmation', () => {
    const r = planPurchaseAdjustments([ev('e1')], 'suggest', resolve);
    expect(r.adjustments[0]!.requiresConfirmation).toBe(true);
  });

  it('auto: exact ones auto, imprecise ones need confirmation; voided/applied/unknown ignored', () => {
    const events = [
      ev('e1'), ev('vague'), ev('e3', { quantity: { kind: 'approximate', originalText: 'a bag' } }),
      ev('e4', { voidedBy: 'u2' }), ev('e5'), ev('ghost'),
    ];
    const r = planPurchaseAdjustments(events, 'auto', resolve, new Set(['e5']));
    expect(r.adjustments.map((a) => [a.sourceEventId, a.requiresConfirmation])).toEqual([['e1', false], ['vague', true], ['e3', true]]);
    expect(r.ignored.map((i) => i.eventId).sort()).toEqual(['e4', 'e5', 'ghost']);
  });

  it('applyAdjustments is idempotent per event id and merges into stock', () => {
    const ctx = mkCtx();
    const plan = planPurchaseAdjustments([ev('e1'), ev('e2', { quantity: q(500, 'g') })], 'auto', resolve);
    const once = applyAdjustments([], plan.adjustments, ctx);
    expect(once).toHaveLength(1);
    expect(once[0]!.quantity.value).toBe(1.5);
    const twice = applyAdjustments(once, plan.adjustments, ctx);
    expect(twice).toEqual(once);
  });

  it('applies supplied expiry', () => {
    const plan = planPurchaseAdjustments([ev('e1')], 'auto', resolve);
    const out = applyAdjustments([], plan.adjustments, mkCtx(), { rice: '2027-01-01' });
    expect(out[0]!.expiry).toBe('2027-01-01');
    expect(out[0]!.source).toBe('purchase');
  });
});
