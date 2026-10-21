import { describe, expect, it } from 'vitest';
import {
  addMonthsIso, batchFromCook, batchStatus, checkPlacement, consume, defaultUseBy, eatenKey, moveToFreezer, plannedPortions, portionsLeft,
  suggestLeftoverSlots, type LeftoverBatch, type LeftoverConsumption,
} from '../../src/leftovers/index';

const chilli: LeftoverBatch = { id: 'b1', title: 'Chilli', portionsMade: 4, storedIn: 'freezer', cookedOn: '2026-10-01', useBy: '2027-01-01' };
const stew: LeftoverBatch = { id: 'b2', title: 'Beef stew', portionsMade: 3, storedIn: 'fridge', cookedOn: '2026-10-20', useBy: '2026-10-22' };

describe('use-by defaults', () => {
  it('2 days in the fridge, 3 calendar months in the freezer', () => {
    expect(defaultUseBy('2026-10-21', 'fridge')).toBe('2026-10-23');
    expect(defaultUseBy('2026-10-21', 'freezer')).toBe('2027-01-21');
  });
  it('clamps month ends and crosses year ends', () => {
    expect(addMonthsIso('2026-11-30', 3)).toBe('2027-02-28');
    expect(addMonthsIso('2027-11-30', 3)).toBe('2028-02-29');
    expect(defaultUseBy('2026-12-30', 'fridge')).toBe('2027-01-01');
  });
});

describe('batchFromCook (Cook x2)', () => {
  it('x2 for 4 servings leaves 4 portions; x3 leaves 8', () => {
    const base = { title: ' Chilli ', servings: 4, storedIn: 'fridge' as const, cookedOn: '2026-10-21', recipeId: 'r1' };
    expect(batchFromCook({ ...base, multiplier: 2 }, 'id')).toMatchObject({ title: 'Chilli', portionsMade: 4, useBy: '2026-10-23', storedIn: 'fridge', recipeId: 'r1' });
    expect(batchFromCook({ ...base, multiplier: 3, storedIn: 'freezer' }, 'id')).toMatchObject({ portionsMade: 8, useBy: '2027-01-21' });
  });
  it('makes nothing for x1, silly multipliers or an empty title', () => {
    const base = { title: 'Chilli', servings: 4, storedIn: 'fridge' as const, cookedOn: '2026-10-21' };
    expect(batchFromCook({ ...base, multiplier: 1 }, 'i')).toBeNull();
    expect(batchFromCook({ ...base, multiplier: 50 }, 'i')).toBeNull();
    expect(batchFromCook({ ...base, multiplier: 2.5 }, 'i')).toBeNull();
    expect(batchFromCook({ ...base, title: '  ', multiplier: 2 }, 'i')).toBeNull();
    expect(batchFromCook({ ...base, servings: 0, multiplier: 2 }, 'i')).toBeNull();
  });
});

describe('the ledger: portions, never double counted', () => {
  it('left = made - consumed', () => {
    const c: LeftoverConsumption[] = [{ batchId: 'b1', key: 'k1', portions: 1, kind: 'eaten' }, { batchId: 'b1', key: 'k2', portions: 2, kind: 'discarded' }, { batchId: 'other', key: 'k3', portions: 9, kind: 'eaten' }];
    expect(portionsLeft(chilli, c)).toBe(1);
  });

  it('applies a key once: marking the same meal eaten twice takes the portions once', () => {
    const key = eatenKey('plan1', '2026-10-22', 'dinner');
    const a = consume(chilli, [], { key, portions: 2 });
    expect(a).toMatchObject({ ok: true, applied: true, portionsLeft: 2 });
    if (!a.ok) throw new Error('unreachable');
    const b = consume(chilli, a.consumptions, { key, portions: 2 });
    expect(b).toMatchObject({ ok: true, applied: false, portionsLeft: 2 });
    if (!b.ok) throw new Error('unreachable');
    expect(b.consumptions).toHaveLength(1);
  });

  it('different meals take different portions; the total can never go below zero', () => {
    let c: LeftoverConsumption[] = [];
    for (const day of ['22', '23']) {
      const r = consume(chilli, c, { key: eatenKey('p', `2026-10-${day}`, 'dinner'), portions: 2 });
      if (!r.ok) throw new Error('unreachable');
      c = r.consumptions;
    }
    expect(portionsLeft(chilli, c)).toBe(0);
    expect(consume(chilli, c, { key: eatenKey('p', '2026-10-24', 'dinner'), portions: 1 })).toEqual({ ok: false, error: 'not_enough', portionsLeft: 0 });
  });

  it('refuses a bad portion count rather than clamping', () => {
    expect(consume(chilli, [], { key: 'k', portions: 0 })).toMatchObject({ ok: false, error: 'invalid_portions' });
    expect(consume(chilli, [], { key: 'k', portions: 1.5 })).toMatchObject({ ok: false, error: 'invalid_portions' });
    expect(consume(chilli, [], { key: '', portions: 1 })).toMatchObject({ ok: false, error: 'invalid_portions' });
    expect(consume(chilli, [], { key: 'k', portions: 5 })).toMatchObject({ ok: false, error: 'not_enough', portionsLeft: 4 });
  });

  it('discarding is a consumption too (it leaves the freezer count)', () => {
    const r = consume(chilli, [], { key: 'discard:1', portions: 1, kind: 'discarded' });
    expect(r).toMatchObject({ ok: true, portionsLeft: 3 });
  });
});

describe('freezing and status', () => {
  it('moving fridge food to the freezer resets the clock to 3 months from today', () => {
    const r = moveToFreezer(stew, '2026-10-21');
    expect(r).toMatchObject({ ok: true, batch: { storedIn: 'freezer', cookedOn: '2026-10-21', useBy: '2027-01-21' } });
  });
  it('refuses food past its fridge use-by, and food already frozen', () => {
    expect(moveToFreezer(stew, '2026-10-23')).toEqual({ ok: false, error: 'past_use_by' });
    expect(moveToFreezer(chilli, '2026-10-21')).toEqual({ ok: false, error: 'already_frozen' });
  });
  it('status: ok, use soon, past use-by', () => {
    expect(batchStatus(stew, '2026-10-20')).toBe('ok');
    expect(batchStatus(stew, '2026-10-21')).toBe('use_soon');
    expect(batchStatus(stew, '2026-10-23')).toBe('past_use_by');
    expect(batchStatus(chilli, '2026-12-25')).toBe('use_soon');
  });
});

describe('suggestions for future plan slots', () => {
  const slots = [
    { date: '2026-10-21', mealType: 'dinner' }, { date: '2026-10-22', mealType: 'dinner' }, { date: '2026-10-23', mealType: 'dinner' },
    { date: '2026-10-24', mealType: 'dinner' }, { date: '2026-10-25', mealType: 'dinner' }, { date: '2026-10-25', mealType: 'snack' },
  ];
  const base = { batches: [chilli, stew], consumptions: [] as LeftoverConsumption[], planned: [], openSlots: slots, busyDates: [] as string[], today: '2026-10-21', portionsPerSlot: 2 };

  it('uses the fridge batch first, before its use-by, and labels freezer meals', () => {
    const out = suggestLeftoverSlots(base);
    const stewRows = out.filter((s) => s.batchId === 'b2');
    expect(stewRows.map((s) => [s.date, s.portions])).toEqual([['2026-10-21', 2], ['2026-10-22', 1]]);
    expect(stewRows[0]!.label).toBe('Leftovers: Beef stew, 2 portions (use by Thu 22 Oct)');
    const chilliRows = out.filter((s) => s.batchId === 'b1');
    expect(chilliRows.map((s) => s.label)).toEqual(['Freezer meal: Chilli, 2 portions', 'Freezer meal: Chilli, 2 portions']);
  });

  it('puts freezer meals on busy evenings first', () => {
    const out = suggestLeftoverSlots({ ...base, batches: [chilli], busyDates: ['2026-10-24'] });
    expect(out.map((s) => s.date)).toContain('2026-10-24');
    expect(out.find((s) => s.date === '2026-10-24')!.reason).toMatch(/busy/i);
    expect(out.map((s) => s.date)).toEqual(['2026-10-21', '2026-10-24']); // busy day first, then the earliest open slot
  });

  it('one suggestion per slot, never a snack, never a past slot', () => {
    const out = suggestLeftoverSlots({ ...base, today: '2026-10-22' });
    expect(new Set(out.map((s) => `${s.date}|${s.mealType}`)).size).toBe(out.length);
    expect(out.some((s) => s.mealType === 'snack')).toBe(false);
    expect(out.some((s) => s.date < '2026-10-22')).toBe(false);
  });

  it('does not hand out portions that are already planned or eaten', () => {
    const planned = [{ batchId: 'b1', portions: 2, date: '2026-10-23', mealType: 'dinner', eaten: false }];
    const eaten: LeftoverConsumption[] = [{ batchId: 'b1', key: 'k', portions: 1, kind: 'eaten' }];
    // chilli: made 4, 1 eaten, 2 planned -> 1 free
    const out = suggestLeftoverSlots({ ...base, batches: [chilli], planned, consumptions: eaten });
    expect(out.reduce((n, s) => n + s.portions, 0)).toBe(1);
  });

  it('an eaten planned meal is no longer "planned" (no double count against the ledger)', () => {
    const planned = [{ batchId: 'b1', portions: 2, date: '2026-10-22', mealType: 'dinner', eaten: true }];
    expect(plannedPortions(planned, 'b1')).toBe(0);
  });

  it('never suggests a batch past its use-by', () => {
    expect(suggestLeftoverSlots({ ...base, batches: [stew], today: '2026-10-23' })).toEqual([]);
  });
});

describe('checkPlacement', () => {
  it('accepts within the portions left and rejects beyond', () => {
    expect(checkPlacement(chilli, 4, 0, 2, '2026-10-23')).toEqual({ ok: true });
    expect(checkPlacement(chilli, 4, 3, 2, '2026-10-23')).toMatchObject({ ok: false, message: 'Only 1 portion of Chilli left to plan.' });
    expect(checkPlacement(chilli, 4, 0, 0, '2026-10-23')).toMatchObject({ ok: false });
  });
  it('refuses a fridge batch on a day after its use-by, allows the freezer', () => {
    expect(checkPlacement(stew, 3, 0, 1, '2026-10-24')).toMatchObject({ ok: false });
    expect(checkPlacement(chilli, 4, 0, 1, '2026-12-24')).toEqual({ ok: true });
  });
});
