import { describe, expect, it } from 'vitest';
import { IngredientMatcher } from '@fr/engine/normalise';
import ingredients from '@fr/refdata/ingredients.json';
import { FIXTURE_CODES, MockProductSource, OFF_FIXTURES, mapNutrition, mapOffProduct, normaliseBarcode, parsePackSize } from '../src';

type Ing = { id: string; name: string };
const cat = ingredients as unknown as ConstructorParameters<typeof IngredientMatcher>[0] & Ing[];
const matcher = new IngredientMatcher(cat);
const byId = new Map((cat as Ing[]).map((i) => [i.id, i.name]));
const now = () => new Date('2026-10-19T12:00:00Z');
const opts = { matcher, nameOf: (id: string) => byId.get(id), now };
const get = (code: string) => mapOffProduct(code, OFF_FIXTURES[code]!, opts)!;
const nut = (p: ReturnType<typeof get>, k: string) => p.nutrition.per100.find((n) => n.nutrient === k)!;

describe('barcodes', () => {
  it('validates check digits and normalises UPC-A', () => {
    expect(normaliseBarcode(FIXTURE_CODES.bakedBeans)).toBe(FIXTURE_CODES.bakedBeans);
    expect(normaliseBarcode(` ${FIXTURE_CODES.bakedBeans.slice(0, 6)}-${FIXTURE_CODES.bakedBeans.slice(6)} `)).toBe(FIXTURE_CODES.bakedBeans);
    expect(normaliseBarcode('123456789013')).toBeNull(); // bad check digit
    expect(normaliseBarcode('abc')).toBeNull();
    expect(normaliseBarcode('036000291452')).toBe('0036000291452'); // valid UPC-A -> EAN-13
    expect(normaliseBarcode('96385074')).toBe('96385074'); // EAN-8
  });
});

describe('pack size', () => {
  it('reads single, multipack, drained and metric variants into g / ml', () => {
    expect(parsePackSize('415 g').packSize).toMatchObject({ value: 415, unit: 'g' });
    expect(parsePackSize('500g').packSize).toMatchObject({ value: 500, unit: 'g' });
    expect(parsePackSize('2 L').packSize).toMatchObject({ value: 2000, unit: 'ml' });
    expect(parsePackSize('1.5 kg').packSize).toMatchObject({ value: 1500, unit: 'g' });
    expect(parsePackSize('75cl').packSize).toMatchObject({ value: 750, unit: 'ml' });
    expect(parsePackSize('400 g (drained 240 g)').packSize).toMatchObject({ value: 400, unit: 'g' });
    const multi = parsePackSize('6 x 125 g');
    expect(multi.packSize).toMatchObject({ value: 750, unit: 'g' });
    expect(multi.packCount).toBe(6);
  });
  it('falls back to product_quantity and never invents', () => {
    expect(parsePackSize('a bag', '250').packSize).toMatchObject({ value: 250, unit: 'g' });
    expect(parsePackSize('a bag').packSize).toBeUndefined();
    expect(parsePackSize(undefined).packSize).toBeUndefined();
  });
});

describe('nutrition mapping', () => {
  it('maps per-100g values with units and sodium g -> mg', () => {
    const p = get(FIXTURE_CODES.bakedBeans);
    expect(nut(p, 'energy_kcal')).toMatchObject({ status: 'known', value: 78, unit: 'kcal' });
    expect(nut(p, 'sodium')).toMatchObject({ status: 'known', value: 220, unit: 'mg' });
    expect(nut(p, 'salt')).toMatchObject({ value: 0.55, unit: 'g' });
    expect(p.nutrition.derived).toEqual([]);
  });
  it('derives salt from sodium only (flagged, estimate) and kcal from kJ-only energy', () => {
    const milk = get(FIXTURE_CODES.semiSkimmedMilk);
    expect(milk.nutrition.derived).toContain('salt');
    expect(nut(milk, 'salt')).toMatchObject({ status: 'known', value: 0.1, estimate: true });
    expect(nut(milk, 'sodium')).toMatchObject({ value: 40 });
    const mystery = get(FIXTURE_CODES.mysterySauce);
    expect(nut(mystery, 'energy_kcal')).toMatchObject({ status: 'known', estimate: true }); // from kJ
    expect(mystery.nutrition.derived).toContain('energy_kcal');
  });
  it('missing is unknown, never 0; explicit 0 is zero', () => {
    const mystery = get(FIXTURE_CODES.mysterySauce);
    for (const k of ['protein', 'carbohydrate', 'sugars', 'saturates', 'fibre', 'salt', 'sodium']) {
      expect(nut(mystery, k)).toMatchObject({ status: 'unknown' });
      expect(nut(mystery, k).value).toBeUndefined();
    }
    const water = get(FIXTURE_CODES.springWater);
    expect(nut(water, 'salt')).toMatchObject({ status: 'zero', value: 0 });
    expect(nut(water, 'fibre')).toMatchObject({ status: 'unknown' });
  });
  it('accepts numeric strings and withholds an implausible block', () => {
    expect(nut(get(FIXTURE_CODES.wholewheatFusilli), 'energy_kcal')).toMatchObject({ value: 348 });
    const bad = get(FIXTURE_CODES.badPerServing);
    expect(bad.nutrition.per100).toEqual([]);
    expect(bad.nutrition.withheldReason).toMatch(/implausible/);
    expect(mapNutrition(undefined, 'g').withheldReason).toMatch(/no nutrition/);
    expect(mapNutrition({ 'energy-kcal_100g': -5 }, 'g').per100).toEqual([]); // negative ignored -> nothing usable
  });
  it('flags liquids as per 100 ml', () => {
    expect(get(FIXTURE_CODES.semiSkimmedMilk).nutrition.per).toBe('ml');
    expect(get(FIXTURE_CODES.bakedBeans).nutrition.per).toBe('g');
  });
});

describe('allergens (UK-14)', () => {
  it('maps contains and traces, dedupes, keeps unmapped tags', () => {
    const p = get(FIXTURE_CODES.wholewheatFusilli);
    expect(p.allergens).toEqual({ status: 'listed', contains: ['cereals_gluten'], traces: ['eggs'], unmapped: ['en:something-odd'] });
    expect(get(FIXTURE_CODES.semiSkimmedMilk).allergens.contains).toEqual(['milk']);
  });
  it('no allergen data is unknown, never "allergen free"', () => {
    expect(get(FIXTURE_CODES.mysterySauce).allergens).toMatchObject({ status: 'unknown', contains: [] });
    // An ingredients list with no allergens is a genuine "listed, none".
    expect(get(FIXTURE_CODES.choppedTomatoes).allergens).toMatchObject({ status: 'listed', contains: [] });
  });
});

describe('product mapping', () => {
  it('carries name, brand, pack size, source and image licence', () => {
    const p = get(FIXTURE_CODES.bakedBeans);
    expect(p).toMatchObject({ name: 'Hearth & Field Baked Beans in Tomato Sauce', brand: 'Hearth & Field', packSizeText: '415 g' });
    expect(p.packSize).toMatchObject({ kind: 'exact', value: 415, unit: 'g' });
    expect(p.source).toEqual({
      publisher: 'Open Food Facts', url: `https://world.openfoodfacts.org/product/${p.barcode}`, code: p.barcode,
      retrievedAt: '2026-10-19T12:00:00.000Z', licence: 'ODbL 1.0 (database), DbCL 1.0 (contents)',
    });
    expect(p.image?.licenceNote).toMatch(/CC BY-SA/);
    expect(get(FIXTURE_CODES.wholewheatFusilli).brand).toBe('Hearth & Field');
  });
  it('drops non-https images and nameless records', () => {
    expect(mapOffProduct('x', { product_name: 'A', image_front_url: 'http://x/y.jpg' })!.image).toBeUndefined();
    expect(mapOffProduct(FIXTURE_CODES.noName, OFF_FIXTURES[FIXTURE_CODES.noName]!)).toBeNull();
  });
});

describe('ingredient suggestion (conservative)', () => {
  it('matches exact generic names / categories only', () => {
    expect(get(FIXTURE_CODES.bakedBeans).suggestion).toMatchObject({ status: 'matched', ingredientName: 'baked beans', via: 'name' });
    expect(get(FIXTURE_CODES.semiSkimmedMilk).suggestion).toMatchObject({ status: 'matched', ingredientName: 'semi-skimmed milk' });
    expect(get(FIXTURE_CODES.mysterySauce).suggestion).toEqual({ status: 'none' });
  });
  it('no matcher = no suggestion; ambiguous matches are returned as candidates, not picked', () => {
    expect(mapOffProduct(FIXTURE_CODES.bakedBeans, OFF_FIXTURES[FIXTURE_CODES.bakedBeans]!)!.suggestion).toEqual({ status: 'none' });
    const ambiguous = { match: () => ({ status: 'ambiguous' as const, candidates: ['a', 'b'] }) };
    const p = mapOffProduct(FIXTURE_CODES.bakedBeans, OFF_FIXTURES[FIXTURE_CODES.bakedBeans]!, { matcher: ambiguous, nameOf: (i) => `ing-${i}` })!;
    expect(p.suggestion).toMatchObject({ status: 'ambiguous', candidates: [{ ingredientId: 'a', ingredientName: 'ing-a' }, { ingredientId: 'b', ingredientName: 'ing-b' }] });
  });
});

describe('mock provider', () => {
  it('looks up, searches and fails like the real one, offline', async () => {
    const m = new MockProductSource({ matcher, now });
    expect((await m.byBarcode(FIXTURE_CODES.bakedBeans))?.name).toMatch(/Baked Beans/);
    expect(await m.byBarcode('4006381333931')).toBeNull();
    await expect(m.byBarcode('123')).rejects.toMatchObject({ code: 'invalid_barcode' });
    expect((await m.search('yogurt')).map((p) => p.packCount)).toEqual([6]);
    expect(await m.search('ab')).toEqual([]);
    await expect(new MockProductSource({ failWith: 'upstream' }).byBarcode(FIXTURE_CODES.bakedBeans)).rejects.toMatchObject({ code: 'upstream' });
  });
});
