import { describe, expect, it } from 'vitest';
import type { OutstandingItem, ParLevel } from '../../src/pantry';
import { restockSuggestions, unitText } from '../../src/pantry';
import { converter, item, NOW, q } from './helpers';

const ING = 'ing-tom';
const par = (over: Partial<ParLevel> = {}): ParLevel => ({
  id: 'p1', householdId: 'h1', ingredientId: ING, name: 'tinned tomatoes', unit: 'can', minValue: 6, enabled: true, ...over,
});
let n = 0;
const stock = (value: number, unit: 'can' | 'g' | 'kg' | 'item' = 'can', over = {}) =>
  item({ id: `s${++n}`, ingredientId: ING, name: 'tinned tomatoes', quantity: q(value, unit), ...over });
const opts = { now: NOW, policy: { staleAfterDays: 30 } };
const list = (value: number, unit: 'can' | 'g' | 'kg' = 'can'): OutstandingItem => ({ ingredientId: ING, name: 'tinned tomatoes', quantity: q(value, unit) });
const run = (s: ReturnType<typeof stock>[], p: ParLevel[], l: OutstandingItem[] = [], o = {}) =>
  restockSuggestions(s, p, l, converter, { ...opts, ...o });

describe('restockSuggestions', () => {
  it('owner example: min 6, have 2, nothing on the list -> add 4, with an explanation', () => {
    const [s] = run([stock(2)], [par()]);
    expect(s).toMatchObject({ kind: 'below_min', quantity: 4, available: 2, min: 6, restockTo: 6, onList: 0, checkQuantity: false, snoozed: false });
    expect(s!.explanation).toBe('You have 2 cans; minimum 6 cans; 0 cans already on the list -> add 4 cans');
  });

  it('nothing when stock is at or above the minimum', () => {
    expect(run([stock(6)], [par()])).toEqual([]);
    expect(run([stock(9)], [par()])).toEqual([]);
  });

  it('subtracts what is already on the list and never goes negative', () => {
    expect(run([stock(2)], [par()], [list(3)])[0]!.quantity).toBe(1);
    expect(run([stock(2)], [par()], [list(4)])).toEqual([]);
    expect(run([stock(2)], [par()], [list(10)])).toEqual([]);
  });

  it('restockTo tops up above the minimum; restockTo below min is clamped to min', () => {
    expect(run([stock(2)], [par({ restockToValue: 10 })])[0]).toMatchObject({ quantity: 8, restockTo: 10 });
    expect(run([stock(2)], [par({ restockToValue: 3 })])[0]).toMatchObject({ quantity: 4, restockTo: 6 });
  });

  it('a par level survives zero stock (no pantry row at all)', () => {
    expect(run([], [par()])[0]!.quantity).toBe(6);
  });

  it('rounds up to whole packs (convertible units)', () => {
    const p = par({ unit: 'g', minValue: 1000, pack: { value: 400, unit: 'g' } });
    const [s] = run([stock(150, 'g')], [p]);
    expect(s).toMatchObject({ quantity: 1200, packs: 3, packSize: 400 });
    expect(s!.explanation).toContain('(3 x 400 g)');
    expect(run([stock(150, 'g')], [par({ unit: 'g', minValue: 1000, pack: { value: 0.5, unit: 'kg' } })])[0]).toMatchObject({ quantity: 1000, packs: 2 });
  });

  it('rounds count units up to whole numbers', () => {
    expect(run([stock(0.5, 'can')], [par({ minValue: 3 })])[0]!.quantity).toBe(3);
  });

  it('converts stock in a different unit of the same dimension', () => {
    const p = par({ unit: 'g', minValue: 1000 });
    expect(run([stock(0.4, 'kg')], [p])[0]).toMatchObject({ available: 400, quantity: 600 });
    expect(run([stock(0.4, 'kg')], [p], [list(0.25, 'kg')])[0]!.quantity).toBe(350);
  });

  it('unit mismatch without a conversion is flagged "check quantity" and not guessed', () => {
    const [s] = run([stock(3, 'item')], [par()]);
    expect(s).toMatchObject({ available: 0, quantity: 6, checkQuantity: true });
    expect(s!.explanation).toContain('Check the quantity');
    expect(s!.notes[0]).toMatch(/cannot be compared/);
  });

  it('approximate stock is not counted and is flagged', () => {
    const approx = item({ id: 'a', ingredientId: ING, name: 'tinned tomatoes', quantity: { kind: 'approximate', originalText: 'a few' } });
    expect(run([approx], [par()])[0]).toMatchObject({ available: 0, checkQuantity: true });
  });

  it('list item with no comparable quantity is flagged', () => {
    const l: OutstandingItem = { ingredientId: ING, name: 'tinned tomatoes', quantity: { kind: 'unparsed', originalText: 'tinned tomatoes' } };
    expect(run([stock(2)], [par()], [l])[0]).toMatchObject({ quantity: 4, checkQuantity: true });
  });

  it('expired stock is never counted; stale stock only with countStale', () => {
    const expired = stock(5, 'can', { expiry: '2026-10-01' });
    expect(run([expired], [par()])[0]!.available).toBe(0);
    const stale = stock(5, 'can', { lastUpdated: '2026-01-01T09:00:00.000Z' });
    const without = run([stale], [par()])[0]!;
    expect(without.available).toBe(0);
    expect(without.notes.join(' ')).toMatch(/not counted: please confirm/);
    expect(run([stale], [par()], [], { countStale: true })[0]!.available).toBe(5); // counted, still below 6
    expect(run([stale, stock(1)], [par()], [], { countStale: true })).toEqual([]); // 6 >= 6
  });

  it('matches free-text pars by normalised name', () => {
    const p = par({ name: 'Birthday Candles', unit: 'item', minValue: 10 });
    delete p.ingredientId;
    const s = item({ id: 'c', name: '  birthday   candles', quantity: q(4, 'item') });
    expect(restockSuggestions([s], [p], [], converter, opts)[0]).toMatchObject({ available: 4, quantity: 6 });
  });

  it('ignores disabled pars; snoozed pars are hidden until the date', () => {
    expect(run([stock(0)], [par({ enabled: false })])).toEqual([]);
    expect(run([stock(0)], [par({ snoozedUntil: '2026-10-22' })])).toEqual([]);
    expect(run([stock(0)], [par({ snoozedUntil: '2026-10-19' })])).toHaveLength(1); // snooze ended today
    const shown = run([stock(0)], [par({ snoozedUntil: '2026-10-22' })], [], { includeSnoozed: true });
    expect(shown[0]!.snoozed).toBe(true);
  });

  it('bought-but-not-yet-in-pantry items count like list items', () => {
    const incoming: OutstandingItem = { ...list(4), source: 'incoming' };
    expect(run([stock(2)], [par()], [incoming])).toEqual([]);
  });

  it('will run low: separate kind from the approved plan, never duplicates a below-min par', () => {
    const plan = [{ ingredientId: ING, name: 'tinned tomatoes', quantity: q(3, 'can') }];
    const [s] = run([stock(7)], [par()], [], { planRequirements: plan });
    expect(s).toMatchObject({ kind: 'will_run_low', planned: 3, quantity: 2 });
    expect(s!.explanation).toMatch(/^After this week's plan you would have 4 cans/);
    expect(run([stock(2)], [par()], [], { planRequirements: plan }).map((x) => x.kind)).toEqual(['below_min']);
    expect(run([stock(7)], [par()], [list(3)], { planRequirements: plan })).toEqual([]);
  });

  it('is deterministic and sorted by name', () => {
    const pars = [par({ id: 'b', name: 'pasta', ingredientId: 'ing-pasta', unit: 'g', minValue: 500 }), par({ id: 'a' })];
    expect(run([], pars).map((s) => s.name)).toEqual(['pasta', 'tinned tomatoes']);
    expect(run([], pars)).toEqual(run([], pars));
  });

  it('unitText pluralises count units', () => {
    expect([unitText(1, 'can'), unitText(2, 'can'), unitText(1, 'item'), unitText(400, 'g'), unitText(2, 'floz')]).toEqual(['1 can', '2 cans', '1 item', '400 g', '2 fl oz']);
  });
});
