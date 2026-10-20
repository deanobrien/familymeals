import { describe, expect, it } from 'vitest';
import {
  applyEstimates, defaultQuantity, estimateShelfLife, mergeCloseUp, mergeLookup, nameItMyself, rapidKey, rowFromDto, rowFromProduct,
  rowFromRapid, toCommitRows, withCount, withDate, withQuantity,
  type ScanLookupLike, type ScanProductLike, type ScanRowDto,
} from '../../src/pantry';

const TODAY = '2026-10-20';
const MILK = { id: 'ing-milk', name: 'milk', category: 'dairy_eggs' };

const dto = (over: Partial<ScanRowDto> = {}): ScanRowDto => ({
  key: 's1', name: 'chickpeas', form: 'canned', packaging: 'tin', count: 3, datesLegible: false, needsCloseUp: true,
  confidence: 0.9, frameRefs: [1], match: { status: 'matched', ingredient: { id: 'ing-chick', name: 'tinned chickpeas', category: 'tinned_jarred' } },
  ...over,
});

const product = (over: Partial<ScanProductLike> = {}): ScanProductLike => ({
  barcode: '5009000000015', name: 'Baked beans', brand: 'Heinz', categories: ['en:canned-beans'], nutrition: { per: 'g' },
  packSize: { value: 415, unit: 'g' }, packSizeText: '415 g', ...over,
});
const lookup = (p = product()): ScanLookupLike => ({ product: p, match: { status: 'matched', ingredient: MILK } });

describe('defaultQuantity (D86)', () => {
  it('counts tins, multiplies a legible pack size, and falls back to item / pack', () => {
    expect(defaultQuantity({ count: 3, packaging: 'tin', packSize: { value: 400, unit: 'g' } })).toEqual({ value: 3, unit: 'can' });
    expect(defaultQuantity({ count: 2, packaging: 'bag', packSize: { value: 500, unit: 'g' } })).toEqual({ value: 1000, unit: 'g' });
    expect(defaultQuantity({ count: 2, packaging: 'loose' })).toEqual({ value: 2, unit: 'item' });
    expect(defaultQuantity({ count: 2, packaging: 'pack' })).toEqual({ value: 2, unit: 'pack' });
    expect(defaultQuantity({ count: 0, packaging: 'loose' })).toEqual({ value: 1, unit: 'item' });
  });
});

describe('rows from a photo scan', () => {
  it('pre-selects a clean match, includes confident rows only, and starts with no dates', () => {
    const r = rowFromDto(dto());
    expect(r.ingredient?.id).toBe('ing-chick');
    expect(r.include).toBe(true);
    expect([r.value, r.unit, r.useBySource]).toEqual(['3', 'can', 'none']);
    expect(rowFromDto(dto({ confidence: 0.3 })).include).toBe(false);
    expect(rowFromDto(dto({ match: { status: 'ambiguous', candidates: [MILK] } })).ingredient).toBeNull();
  });

  it('changing the count re-derives the quantity until the owner types their own', () => {
    const r = rowFromDto(dto());
    expect(withCount(r, '5').value).toBe('5');
    const edited = withQuantity(r, { value: '2' });
    expect(withCount(edited, '5').value).toBe('2');
  });
});

describe('close-up merge (D88)', () => {
  it('takes dates from the close-up but never overwrites a typed date', () => {
    const typed = withDate(rowFromDto(dto()), 'useBy', '2026-12-01');
    const out = mergeCloseUp(typed, dto({ useBy: '2027-01-01', bestBefore: '2027-02-02' }));
    expect(out.useBy).toBe('2026-12-01');
    expect(out.bestBefore).toBe('2027-02-02');
    expect([out.closeUp, out.needsCloseUp]).toEqual(['done', false]);
  });

  it('flags an unreadable close-up and keeps the row', () => {
    const out = mergeCloseUp(rowFromDto(dto()), dto());
    expect(out.closeUp).toBe('unread');
    expect(out.closeUpMessage).toMatch(/type the date/);
  });
});

describe('opt-in shelf-life estimate (D87)', () => {
  it('labels an estimate only on rows with no date, and removes it again when switched off', () => {
    const dated = withDate(rowFromDto(dto({ key: 'a' })), 'useBy', '2026-11-01');
    const bare = rowFromDto(dto({ key: 'b' }));
    const on = applyEstimates([dated, bare], true, TODAY);
    expect(on[0]!.bestBeforeSource).toBe('none');
    expect(on[1]).toMatchObject({ bestBeforeSource: 'estimate', bestBefore: '2027-10-20' });
    const off = applyEstimates(on, false, TODAY);
    expect(off[1]).toMatchObject({ bestBefore: '', bestBeforeSource: 'none' });
    expect(estimateShelfLife(undefined, 'ambient', TODAY)).toBeNull();
    expect(estimateShelfLife('fruit_veg', 'fresh', TODAY)?.date).toBe('2026-10-27');
  });
});

describe('product and continuous-scan rows (X2, BS1)', () => {
  it('a product row is a tin for canned goods, one pack, dates empty', () => {
    const r = rowFromProduct(lookup(), 'k1');
    expect(r).toMatchObject({ form: 'canned', packaging: 'tin', count: '1', value: '1', unit: 'can', barcode: '5009000000015', useBySource: 'none' });
    expect(r.scannedName).toBe('Baked beans'.startsWith('Heinz') ? 'Baked beans' : 'Heinz Baked beans');
  });

  it('a rapid row waits on its lookup, then adopts the product but keeps count, dates and include', () => {
    const pending = rowFromRapid('5009000000015', 3, undefined);
    expect([pending.key, pending.lookup, pending.count]).toEqual([rapidKey('5009000000015'), 'pending', '3']);
    expect(toCommitRows([pending]).errors[pending.key]).toMatch(/Still looking/);
    const dated = withDate({ ...pending, include: false }, 'useBy', '2026-11-05');
    const merged = mergeLookup(dated, { state: 'done', value: lookup() });
    expect(merged).toMatchObject({ count: '3', include: false, useBy: '2026-11-05', barcode: '5009000000015', rapid: true });
    expect(merged.ingredient?.id).toBe('ing-milk');
  });

  it('not found / failed lookups ask for a name, and a hand-named row is never touched', () => {
    const nf = mergeLookup(rowFromRapid('5009000000015', 1, undefined), { state: 'notfound' });
    expect(nf.lookup).toBe('notfound');
    const manual = nameItMyself(nf);
    expect(mergeLookup(manual, { state: 'done', value: lookup() })).toBe(manual);
  });
});

describe('toCommitRows', () => {
  it('sends only included, valid rows, with the stricter use-by date and barcode', () => {
    const ok = withDate(withDate({ ...rowFromProduct(lookup(), 'k1') }, 'bestBefore', '2027-01-01'), 'useBy', '2026-12-01');
    const excluded = { ...rowFromDto(dto({ key: 'x' })), include: false };
    const noName = { ...rowFromDto(dto({ key: 'n', match: { status: 'unmatched', suggestions: [] }, name: '' })), freeName: '' };
    const zero = withQuantity(rowFromDto(dto({ key: 'z' })), { value: '0' });
    const out = toCommitRows([ok, excluded, noName, zero]);
    expect(out.rows).toEqual([{ key: 'k1', ingredientId: 'ing-milk', value: 1, unit: 'can', expiry: '2026-12-01', barcode: '5009000000015' }]);
    expect(Object.keys(out.errors).sort()).toEqual(['n', 'z']);
  });

  it('free-text rows carry the name, not an ingredient id', () => {
    const r = { ...rowFromDto(dto({ match: { status: 'unmatched', suggestions: [] }, name: 'odd sauce' })), ingredient: null };
    expect(toCommitRows([r]).rows[0]).toMatchObject({ name: 'odd sauce' });
    expect(toCommitRows([r]).rows[0]).not.toHaveProperty('ingredientId');
  });
});
