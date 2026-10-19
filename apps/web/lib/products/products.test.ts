import { describe, expect, it, vi } from 'vitest';
import { FIXTURE_CODES, MockProductSource } from '@fr/product-sources';
import { IngredientMatcher } from '@fr/engine/normalise';
import ingredients from '@fr/refdata/ingredients.json';
import { fmtNum, rowFromProduct, toCommitRows, withCount } from '../pantry/scan-rows';
import { looksLikeRetailCode, platformDetector, startScanLoop, type BarcodeDetectorLike } from './barcode-detect';
import { fetchProduct } from './client';
import { allergenLabel, nutritionLines } from './labels';
import type { ProductLookupDto } from './types';

const cat = ingredients as unknown as { id: string; name: string; category: string; aliases: string[] }[];
const matcher = new IngredientMatcher(cat as never);
const source = new MockProductSource({ matcher, nameOf: (id) => cat.find((i) => i.id === id)?.name });
const lookup = async (code: string): Promise<ProductLookupDto> => {
  const product = (await source.byBarcode(code))!;
  const s = product.suggestion;
  const ing = s.status === 'matched' ? cat.find((i) => i.id === s.ingredientId) : undefined;
  return { product, provider: { id: 'mock', isMock: true }, match: ing ? { status: 'matched', ingredient: { id: ing.id, name: ing.name, category: ing.category } } : { status: 'unmatched', suggestions: [] } };
};

describe('rowFromProduct', () => {
  it('prefills name, pack size, matched ingredient; dates stay empty', async () => {
    const row = rowFromProduct(await lookup(FIXTURE_CODES.bakedBeans), 'k1');
    expect(row).toMatchObject({ barcode: FIXTURE_CODES.bakedBeans, include: true, count: '1', packaging: 'tin', form: 'canned', useBy: '', bestBefore: '', useBySource: 'none', bestBeforeSource: 'none' });
    expect(row.ingredient?.name).toBe('baked beans');
    expect(row.packSizeText).toBe('415 g');
    expect(row.packSize).toEqual({ value: 415, unit: 'g' });
    expect({ value: row.value, unit: row.unit }).toEqual({ value: '1', unit: 'can' }); // tins are counted in cans (D86)
    expect(row.scannedName).toMatch(/Baked Beans/);
  });

  it('a pack with mass uses count x pack size; multipack is one pack of the whole size; liquid is ml', async () => {
    const pasta = rowFromProduct(await lookup(FIXTURE_CODES.wholewheatFusilli), 'k2');
    expect({ value: pasta.value, unit: pasta.unit }).toEqual({ value: '500', unit: 'g' });
    const doubled = withCount(pasta, '2');
    expect(doubled.value).toBe('1000');
    const yogurt = rowFromProduct(await lookup(FIXTURE_CODES.yogurtMultipack), 'k3');
    expect({ value: yogurt.value, unit: yogurt.unit }).toEqual({ value: '750', unit: 'g' });
    const milk = rowFromProduct(await lookup(FIXTURE_CODES.semiSkimmedMilk), 'k4');
    expect({ value: milk.value, unit: milk.unit, packaging: milk.packaging }).toEqual({ value: '2000', unit: 'ml', packaging: 'bottle' });
    expect(fmtNum(1.5)).toBe('1.5');
  });

  it('an unmatched product is not pre-selected: it needs an ingredient or a name before it can be added', async () => {
    const row = rowFromProduct(await lookup(FIXTURE_CODES.mysterySauce), 'k5');
    expect(row.ingredient).toBeNull();
    const c = toCommitRows([{ ...row, freeName: '' }]);
    expect(c.rows).toEqual([]);
    expect(c.errors.k5).toMatch(/Choose an ingredient/);
  });

  it('commit rows carry the barcode (so confirm can link the product) only for barcode rows', async () => {
    const row = rowFromProduct(await lookup(FIXTURE_CODES.bakedBeans), 'k6');
    const c = toCommitRows([row, { ...row, key: 'k7', barcode: undefined, product: undefined }]);
    expect(c.rows[0]).toMatchObject({ key: 'k6', barcode: FIXTURE_CODES.bakedBeans, unit: 'can', value: 1 });
    expect(c.rows[0]!.ingredientId).toBe(row.ingredient!.id);
    expect(c.rows[1]).not.toHaveProperty('barcode');
  });
});

describe('barcode detection loop', () => {
  const fakeSchedule = () => {
    const queue: Array<() => void> = [];
    return { schedule: (fn: () => void) => { queue.push(fn); return queue.length; }, cancelSchedule: () => queue.splice(0), run: async () => { const fn = queue.shift(); fn?.(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }, queue };
  };

  it('keeps polling through empty/failed frames, reports the first retail code once, then stops', async () => {
    const frames: Array<Array<{ rawValue: string }> | Error> = [[], new Error('not ready'), [{ rawValue: 'QR-CODE-TEXT' }], [{ rawValue: FIXTURE_CODES.bakedBeans }], [{ rawValue: '5000000000000' }]];
    const detector: BarcodeDetectorLike = { detect: vi.fn(async () => { const f = frames.shift()!; if (f instanceof Error) throw f; return f; }) };
    const onCode = vi.fn();
    const s = fakeSchedule();
    startScanLoop({ detector, source: {}, onCode, schedule: s.schedule, cancelSchedule: s.cancelSchedule });
    for (let i = 0; i < 6; i++) await s.run();
    expect(onCode).toHaveBeenCalledTimes(1);
    expect(onCode).toHaveBeenCalledWith(FIXTURE_CODES.bakedBeans);
    expect(detector.detect).toHaveBeenCalledTimes(4);
    expect(s.queue).toHaveLength(0);
  });

  it('stop() prevents any further detection', async () => {
    const detector: BarcodeDetectorLike = { detect: vi.fn(async () => []) };
    const s = fakeSchedule();
    const stop = startScanLoop({ detector, source: {}, onCode: vi.fn(), schedule: s.schedule, cancelSchedule: s.cancelSchedule });
    stop();
    await s.run();
    expect(detector.detect).not.toHaveBeenCalled();
  });

  it('feature-detects the platform BarcodeDetector', () => {
    expect(platformDetector({})).toBeNull();
    const made: unknown[] = [];
    class Fake { constructor(o: unknown) { made.push(o); } detect = async () => []; }
    const f = platformDetector({ BarcodeDetector: Fake })!;
    expect(f(['ean_13'])).toBeInstanceOf(Fake);
    expect(made).toEqual([{ formats: ['ean_13'] }]);
    expect(looksLikeRetailCode('5000157024671') && looksLikeRetailCode('96385074') && looksLikeRetailCode('036000291452')).toBe(true);
    expect(looksLikeRetailCode('ABC12345')).toBe(false);
  });
});

describe('fetchProduct (browser helper)', () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  it('validates digits before any request, strips spaces, and never throws', async () => {
    const f = vi.fn(async () => json({ product: { barcode: 'x' }, match: { status: 'unmatched', suggestions: [] }, provider: { id: 'mock', isMock: true } }));
    expect(await fetchProduct('12', f as never)).toMatchObject({ ok: false, error: { code: 'invalid_barcode' } });
    expect(f).not.toHaveBeenCalled();
    expect((await fetchProduct('5000 1570 24671', f as never)).ok).toBe(true);
    expect(f).toHaveBeenCalledWith('/api/products/5000157024671');
    expect(await fetchProduct('5000157024671', (async () => json({ error: { code: 'not_found', message: 'nope', retryable: false } }, 404)) as never)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await fetchProduct('5000157024671', (async () => { throw new TypeError('offline'); }) as never)).toMatchObject({ ok: false, error: { code: 'NETWORK', retryable: true } });
    expect(await fetchProduct('5000157024671', (async () => new Response('<html>', { status: 500 })) as never)).toMatchObject({ ok: false, error: { code: 'UNEXPECTED' } });
  });
});

describe('labels', () => {
  it('shows unknown nutrients as "not on the record", derived values as calculated, allergen names in words', async () => {
    const mystery = nutritionLines((await lookup(FIXTURE_CODES.mysterySauce)).product);
    expect(mystery.find((l) => l.label === 'Protein')?.text).toBe('not on the record');
    expect(mystery.find((l) => l.label === 'Energy')?.text).toMatch(/calculated/);
    const milk = nutritionLines((await lookup(FIXTURE_CODES.semiSkimmedMilk)).product);
    expect(milk.find((l) => l.label === 'Salt')?.text).toBe('0.1 g (calculated)');
    expect(nutritionLines((await lookup(FIXTURE_CODES.badPerServing)).product)).toEqual([]);
    expect(allergenLabel('cereals_gluten')).toBe('Cereals containing gluten');
  });
});
