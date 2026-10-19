import { describe, expect, it } from 'vitest';
import {
  applyEstimates, confidenceTone, defaultQuantity, mergeCloseUp, rowExpiry, rowFromDto, toCommitRows, withCount, withDate, withQuantity,
} from './scan-rows';
import { estimateShelfLife } from './shelf-life';
import type { ScanRowDto } from './scan-types';

const carrot = { id: 'c-1', name: 'carrot', category: 'fruit_veg' };
const dto = (over: Partial<ScanRowDto> = {}): ScanRowDto => ({
  key: 's1', name: 'carrot', form: 'fresh', packaging: 'loose', count: 5, datesLegible: false, needsCloseUp: false, confidence: 0.9,
  frameRefs: [1], match: { status: 'matched', ingredient: carrot }, ...over,
});

describe('default quantity from a scanned item', () => {
  it('counts loose items, tins and plain packs', () => {
    expect(defaultQuantity({ count: 5, packaging: 'loose' })).toEqual({ value: 5, unit: 'item' });
    expect(defaultQuantity({ count: 2, packaging: 'tin' })).toEqual({ value: 2, unit: 'can' });
    expect(defaultQuantity({ count: 2, packaging: 'tin', packSize: { value: 400, unit: 'g' } })).toEqual({ value: 2, unit: 'can' });
    expect(defaultQuantity({ count: 3, packaging: 'bag' })).toEqual({ value: 3, unit: 'pack' });
  });
  it('multiplies a legible mass or volume pack size by the count', () => {
    expect(defaultQuantity({ count: 1, packaging: 'pack', packSize: { value: 650, unit: 'g' } })).toEqual({ value: 650, unit: 'g' });
    expect(defaultQuantity({ count: 3, packaging: 'bottle', packSize: { value: 0.5, unit: 'l' } })).toEqual({ value: 1.5, unit: 'l' });
    expect(defaultQuantity({ count: 2, packaging: 'jar', packSize: { value: 2, unit: 'item' } })).toEqual({ value: 2, unit: 'pack' });
  });
});

describe('scan rows', () => {
  it('prefills dates from the scan, auto-picks a clean match and leaves low-confidence rows unticked', () => {
    const r = rowFromDto(dto({ useBy: '2026-10-21', bestBefore: '2026-10-25', datesLegible: true }));
    expect(r.ingredient).toEqual(carrot);
    expect(r).toMatchObject({ useBy: '2026-10-21', bestBefore: '2026-10-25', useBySource: 'scan', bestBeforeSource: 'scan', include: true, value: '5', unit: 'item' });
    expect(rowFromDto(dto({ confidence: 0.3 })).include).toBe(false);
    const amb = rowFromDto(dto({ match: { status: 'ambiguous', candidates: [carrot] } }));
    expect(amb.ingredient).toBeNull();
    expect(amb.freeName).toBe('carrot');
  });

  it('use by wins over best before for the single pantry expiry; either alone is used; none stays empty', () => {
    expect(rowExpiry({ useBy: '2026-10-21', bestBefore: '2026-10-25' })).toBe('2026-10-21');
    expect(rowExpiry({ useBy: '', bestBefore: '2026-10-25' })).toBe('2026-10-25');
    expect(rowExpiry({ useBy: '', bestBefore: '' })).toBeUndefined();
  });

  it('changing the count re-derives the quantity until the owner types their own', () => {
    let r = rowFromDto(dto());
    r = withCount(r, '7');
    expect(r).toMatchObject({ count: '7', value: '7', unit: 'item' });
    r = withQuantity(r, { value: '1.2', unit: 'kg' });
    r = withCount(r, '3');
    expect(r).toMatchObject({ count: '3', value: '1.2', unit: 'kg' });
    // clearing the box mid-typing does not wipe the quantity
    expect(withCount(rowFromDto(dto()), '').value).toBe('5');
  });

  it('typing a date marks it as the owner\'s; clearing it removes it', () => {
    let r = withDate(rowFromDto(dto()), 'useBy', '2026-11-01');
    expect(r).toMatchObject({ useBy: '2026-11-01', useBySource: 'user' });
    r = withDate(r, 'useBy', '');
    expect(r).toMatchObject({ useBy: '', useBySource: 'none' });
  });

  it('confidence badge tones', () => {
    expect(confidenceTone(0.9).tone).toBe('success');
    expect(confidenceTone(0.7).tone).toBe('warning');
    expect(confidenceTone(0.4).tone).toBe('danger');
  });
});

describe('close-up merge', () => {
  const yog = (over: Partial<ScanRowDto> = {}) => rowFromDto(dto({ key: 's4', name: 'natural yoghurt', packaging: 'pack', count: 1, needsCloseUp: true, ...over }));
  const result = (over: Partial<ScanRowDto> = {}) => dto({ key: 'c1', name: 'natural yoghurt', useBy: '2026-10-22', datesLegible: true, ...over });

  it('takes the dates from the close-up and clears the needs-close-up flag', () => {
    const r = mergeCloseUp(yog(), result());
    expect(r).toMatchObject({ useBy: '2026-10-22', useBySource: 'closeup', needsCloseUp: false, closeUp: 'done' });
  });
  it('never overwrites a date the owner typed, but fills the other one', () => {
    const typed = withDate(yog(), 'useBy', '2026-10-30');
    const r = mergeCloseUp(typed, result({ useBy: '2026-10-22', bestBefore: '2026-11-02' }));
    expect(r.useBy).toBe('2026-10-30');
    expect(r.bestBefore).toBe('2026-11-02');
    expect(r.bestBeforeSource).toBe('closeup');
  });
  it('stays flagged, with a message, when the close-up is still unreadable (or empty)', () => {
    const a = mergeCloseUp(yog(), result({ useBy: undefined, datesLegible: false, needsCloseUp: true }));
    expect(a).toMatchObject({ needsCloseUp: true, closeUp: 'unread', useBy: '' });
    expect(a.closeUpMessage).toMatch(/could not read/i);
    expect(mergeCloseUp(yog(), undefined).closeUp).toBe('unread');
  });
  it('drops a leftover estimate once a real date is read, and learns a pack size it did not have', () => {
    let r = applyEstimates([yog()], true, '2026-10-19')[0]!;
    expect(r.bestBeforeSource).toBe('estimate');
    r = mergeCloseUp(r, result({ packSizeText: '500g', packSize: { value: 500, unit: 'g' } }));
    expect(r.bestBefore).toBe('');
    expect(r.bestBeforeSource).toBe('none');
    expect(r).toMatchObject({ packSizeText: '500g', value: '500', unit: 'g' });
  });
});

describe('typical shelf life (opt-in estimate)', () => {
  it('is table-driven: category and form give days, an unknown category gives nothing', () => {
    expect(estimateShelfLife('fruit_veg', 'fresh', '2026-10-19')).toMatchObject({ days: 7, date: '2026-10-26' });
    expect(estimateShelfLife('meat_poultry', 'chilled', '2026-10-19')?.days).toBe(2);
    expect(estimateShelfLife('dairy_eggs', 'frozen', '2026-10-19')?.days).toBe(90);
    expect(estimateShelfLife('tinned_jarred', 'canned', '2026-10-19')?.days).toBe(365);
    expect(estimateShelfLife('mystery', 'fresh', '2026-10-19')).toBeNull();
    expect(estimateShelfLife(undefined, 'other', '2026-10-19')).toBeNull();
    expect(estimateShelfLife('fruit_veg', 'fresh', '2026-10-19')?.label).toMatch(/typical/);
  });

  it('only fills rows with no date, labels them as estimates, and removes them again when switched off', () => {
    const noDate = rowFromDto(dto({ key: 'a' }));
    const withLabel = rowFromDto(dto({ key: 'b', useBy: '2026-10-21', datesLegible: true }));
    const typed = withDate(rowFromDto(dto({ key: 'c' })), 'bestBefore', '2026-12-01');
    const on = applyEstimates([noDate, withLabel, typed], true, '2026-10-19');
    expect(on[0]).toMatchObject({ bestBefore: '2026-10-26', bestBeforeSource: 'estimate' });
    expect(on[1]).toMatchObject({ useBy: '2026-10-21', bestBefore: '' });
    expect(on[2]).toMatchObject({ bestBefore: '2026-12-01', bestBeforeSource: 'user' });
    const off = applyEstimates(on, false, '2026-10-19');
    expect(off[0]).toMatchObject({ bestBefore: '', bestBeforeSource: 'none' });
    expect(off[2]!.bestBefore).toBe('2026-12-01');
  });

  it('is never applied by default: a freshly built row has no date', () => {
    const r = rowFromDto(dto());
    expect(rowExpiry(r)).toBeUndefined();
  });
});

describe('commit rows', () => {
  it('sends only included, valid rows with the single expiry; free text keeps its name', () => {
    const a = rowFromDto(dto({ key: 'a', useBy: '2026-10-21', bestBefore: '2026-10-25', datesLegible: true }));
    const b = { ...rowFromDto(dto({ key: 'b', name: 'kohlrabi', match: { status: 'unmatched', suggestions: [] } })), include: true };
    const c = { ...rowFromDto(dto({ key: 'c' })), include: false };
    const { rows, errors } = toCommitRows([a, b, c]);
    expect(errors).toEqual({});
    expect(rows).toEqual([
      { key: 'a', ingredientId: 'c-1', value: 5, unit: 'item', expiry: '2026-10-21' },
      { key: 'b', name: 'kohlrabi', value: 5, unit: 'item' },
    ]);
  });
  it('reports included rows with no quantity or name, and ignores excluded bad rows', () => {
    const bad = withQuantity(rowFromDto(dto({ key: 'a' })), { value: '0' });
    const noName = { ...rowFromDto(dto({ key: 'b', match: { status: 'unmatched', suggestions: [] } })), freeName: '  ' };
    const excluded = { ...withQuantity(rowFromDto(dto({ key: 'c' })), { value: 'x' }), include: false };
    const { rows, errors } = toCommitRows([bad, noName, excluded]);
    expect(rows).toEqual([]);
    expect(Object.keys(errors).sort()).toEqual(['a', 'b']);
  });
});
