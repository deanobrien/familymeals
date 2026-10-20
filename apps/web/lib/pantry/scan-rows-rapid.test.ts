import { describe, expect, it } from 'vitest';
import { FIXTURE_CODES, MockProductSource } from '@fr/product-sources';
import { lookupProduct } from '../server/products/lookup';
import { getIngredientCatalogue } from '../server/refdata/catalogue';
import type { ProductLookupDto } from '../products/types';
import { mergeLookup, nameItMyself, rapidKey, rowFromRapid, toCommitRows, withDate } from './scan-rows';

const cat = getIngredientCatalogue();
const source = new MockProductSource({ matcher: cat.matcher, nameOf: (id) => cat.get(id)?.name });
const BEANS = FIXTURE_CODES.bakedBeans;

async function beans(): Promise<ProductLookupDto> {
  const out = await lookupProduct(BEANS, { source });
  if (!out.ok) throw new Error('fixture');
  return out.lookup;
}

describe('rapid rows (continuous scan review)', () => {
  it('a known product becomes the normal product row with the scanned count', async () => {
    const r = rowFromRapid(BEANS, 3, { state: 'done', value: await beans() });
    expect(r).toMatchObject({ key: rapidKey(BEANS), rapid: true, scanBarcode: BEANS, barcode: BEANS, count: '3', unit: 'can', value: '3', useBy: '', bestBefore: '' });
    expect(r.ingredient?.name).toBe('baked beans');
    expect(toCommitRows([r]).rows[0]).toMatchObject({ value: 3, unit: 'can', barcode: BEANS });
  });

  it('a pending code is a placeholder that blocks confirm until named or resolved', () => {
    const r = rowFromRapid(BEANS, 2, { state: 'pending' });
    expect(r).toMatchObject({ lookup: 'pending', count: '2', include: true });
    const c = toCommitRows([r]);
    expect(c.rows).toEqual([]);
    expect(c.errors[r.key]).toMatch(/Still looking/);
    // naming it yourself stops the wait; the typed name is then committed (no barcode link: the product is unknown)
    const named = { ...nameItMyself(r), freeName: 'Gran’s chutney' };
    expect(toCommitRows([named]).rows[0]).toMatchObject({ name: 'Gran’s chutney', value: 2, unit: 'pack' });
    expect(toCommitRows([named]).rows[0]!.barcode).toBeUndefined();
  });

  it('not found and failed lookups ask for a name, with a message', () => {
    const nf = rowFromRapid('4006381333931', 1, { state: 'notfound' });
    expect(nf).toMatchObject({ lookup: 'notfound' });
    expect(toCommitRows([nf]).errors[nf.key]).toMatch(/type a name/);
    const failed = rowFromRapid('4006381333931', 1, { state: 'error', error: { code: 'upstream', message: 'down', retryable: true } });
    expect(failed).toMatchObject({ lookup: 'failed', lookupMessage: 'down' });
  });

  it('a lookup that finishes later fills the row but keeps count, dates, include and close-up state', async () => {
    let r = rowFromRapid(BEANS, 4, { state: 'pending' });
    r = withDate({ ...r, include: false }, 'bestBefore', '2027-01-01');
    const m = mergeLookup(r, { state: 'done', value: await beans() });
    expect(m).toMatchObject({ barcode: BEANS, count: '4', include: false, bestBefore: '2027-01-01', bestBeforeSource: 'user' });
    expect(m.lookup).toBeUndefined();
    expect(m.product?.name).toMatch(/Baked Beans/);
    expect(m.value).toBe('4');
  });

  it('never overwrites a row the owner named, or one that already has its product', async () => {
    const named = { ...nameItMyself(rowFromRapid(BEANS, 1, { state: 'pending' })), freeName: 'mine' };
    expect(mergeLookup(named, { state: 'done', value: await beans() })).toBe(named);
    const known = rowFromRapid(BEANS, 1, { state: 'done', value: await beans() });
    expect(mergeLookup(known, { state: 'notfound' })).toBe(known);
  });

  it('pending -> notfound / error / pending transitions update the marker only', () => {
    const p = rowFromRapid(BEANS, 1, { state: 'pending' });
    expect(mergeLookup(p, { state: 'pending' })).toBe(p);
    expect(mergeLookup(p, { state: 'notfound' })).toMatchObject({ lookup: 'notfound' });
    const f = mergeLookup(p, { state: 'error', error: { code: 'x', message: 'bad', retryable: true } });
    expect(f).toMatchObject({ lookup: 'failed', lookupMessage: 'bad' });
    expect(mergeLookup(f, { state: 'pending' })).toMatchObject({ lookup: 'pending' }); // retry
    expect(mergeLookup(p, undefined)).toBe(p);
  });
});
