import { describe, expect, it } from 'vitest';
import { FIXTURE_CODES, OFF_FIXTURES, mapOffProduct, type OffProduct, type Product } from '@fr/product-sources';
import { getIngredientCatalogue } from '../refdata/catalogue';
import { InMemoryProductSnapshotStore } from '../products/store';
import { createRecipeCalculator, type CalcRecipe } from './index';
import { profileFromProduct } from './product-nutrition';

const cat = getIngredientCatalogue();
const BEANS = cat.matcher.match('baked beans').ingredientId!;
const now = () => new Date('2026-10-19T12:00:00Z');
const H1 = 'aa000000-0000-4000-8000-0000000000aa';
const H2 = 'cc000000-0000-4000-8000-0000000000cc';

const recipe = (id = 'r1', updatedAt = '2026-10-19T00:00:00Z'): CalcRecipe => ({
  id, servings: 2, updatedAt,
  ingredients: [{ id: 'l1', name: 'baked beans', quantity: { kind: 'exact', value: 400, unit: 'g', originalText: '400 g' }, optional: false, order: 0 }],
});

const product = (patch: Partial<OffProduct> = {}, base = FIXTURE_CODES.bakedBeans): Product =>
  mapOffProduct(base, { ...OFF_FIXTURES[base]!, ...patch }, { matcher: cat.matcher, now })!;

const link = (store: InMemoryProductSnapshotStore, hh: string, p: Product, ingredientId: string | null = BEANS, linkedAt = '2026-10-19T09:00:00Z') =>
  store.save(hh, { barcode: p.barcode, ingredientId, product: p, linkedAt });

const calcFor = (store: InMemoryProductSnapshotStore, hh = H1) =>
  createRecipeCalculator({ productSource: store.asNutritionSource(hh), now });

describe('profileFromProduct', () => {
  it('uses a per-100 g label with energy, labelled as from the product label', () => {
    const p = profileFromProduct(product())!;
    expect(p.per100g.energy_kcal).toMatchObject({ status: 'known', value: 78, estimate: false });
    expect(p.per100g.energy_kcal?.source).toMatch(/^from product label via Open Food Facts: Hearth & Field Baked Beans in Tomato Sauce \(\d+\)$/);
    expect(p.per100g.sodium).toMatchObject({ value: 220 });
  });
  it('refuses liquids, withheld blocks and labels without energy (CoFID is kept)', () => {
    expect(profileFromProduct(product({}, FIXTURE_CODES.semiSkimmedMilk))).toBeUndefined(); // per 100 ml
    expect(profileFromProduct(product({}, FIXTURE_CODES.badPerServing))).toBeUndefined(); // implausible, withheld
    expect(profileFromProduct(product({ nutriments: { proteins_100g: 5 } }))).toBeUndefined(); // no energy
  });
  it('marks derived nutrients and keeps unknown as unknown with no value', () => {
    const p = profileFromProduct(product({ nutriments: { 'energy-kj_100g': 420, fat_100g: 2, sodium_100g: 0.1 } }))!;
    expect(p.per100g.energy_kcal).toMatchObject({ status: 'known', derived: true, estimate: true });
    expect(p.per100g.salt).toMatchObject({ derived: true });
    expect(p.per100g.fibre).toMatchObject({ status: 'unknown' });
    expect(p.per100g.fibre?.value).toBeUndefined();
  });
});

describe('recipe nutrition prefers a linked product over CoFID, with provenance', () => {
  it('without a linked product the CoFID profile is used', () => {
    const r = calcFor(new InMemoryProductSnapshotStore()).forRecipe(recipe()).nutrition;
    expect(r.productSources).toBeUndefined();
    expect(r.attribution).not.toMatch(/Open Food Facts/);
  });

  it('with a linked product the label figures replace CoFID and the result says so', () => {
    const store = new InMemoryProductSnapshotStore();
    link(store, H1, product({ nutriments: { 'energy-kcal_100g': 100, proteins_100g: 5, fat_100g: 1, carbohydrates_100g: 10, salt_100g: 0.5 } }));
    const plain = calcFor(new InMemoryProductSnapshotStore()).forRecipe(recipe()).nutrition;
    const n = calcFor(store).forRecipe(recipe()).nutrition;
    expect(n.totals.energy_kcal.value).toBe(400); // 400 g x 100 kcal / 100 g
    expect(n.totals.energy_kcal.value).not.toBe(plain.totals.energy_kcal.value);
    expect(n.perServing.energy_kcal.value).toBe(200);
    expect(n.totals.energy_kcal.sources.join(' ')).toMatch(/from product label via Open Food Facts/);
    expect(n.productSources).toEqual([
      expect.objectContaining({ ingredientId: BEANS, ingredientName: 'baked beans', productName: expect.stringContaining('Baked Beans'), barcode: FIXTURE_CODES.bakedBeans, url: expect.stringContaining(FIXTURE_CODES.bakedBeans) }),
    ]);
    expect(n.attribution).toMatch(/Open Food Facts contributors, ODbL/);
    expect(n.attribution).toMatch(/CoFID/); // other ingredients still credit CoFID
  });

  it('a nutrient the label omits stays unknown: never 0, never backfilled from CoFID', () => {
    const store = new InMemoryProductSnapshotStore();
    link(store, H1, product({ nutriments: { 'energy-kcal_100g': 100, fat_100g: 1 } }));
    const n = calcFor(store).forRecipe(recipe()).nutrition;
    expect(n.totals.fibre.status).toBe('unknown');
    expect(n.totals.fibre.value).toBeUndefined();
    expect(n.totals.protein.status).toBe('unknown');
  });

  it('ignores unusable products and unlinked snapshots', () => {
    const store = new InMemoryProductSnapshotStore();
    link(store, H1, product({ nutriments: { proteins_100g: 5 } })); // no energy
    link(store, H1, product({}, FIXTURE_CODES.choppedTomatoes), null); // not linked to an ingredient
    expect(calcFor(store).forRecipe(recipe()).nutrition.productSources).toBeUndefined();
  });

  it('the most recently linked usable product wins', () => {
    const store = new InMemoryProductSnapshotStore();
    link(store, H1, product({ nutriments: { 'energy-kcal_100g': 50 } }), BEANS, '2026-10-01T00:00:00Z');
    link(store, H1, product({ nutriments: { 'energy-kcal_100g': 90 }, product_name: 'Newer beans' }, FIXTURE_CODES.choppedTomatoes), BEANS, '2026-10-10T00:00:00Z');
    const n = calcFor(store).forRecipe(recipe()).nutrition;
    expect(n.totals.energy_kcal.value).toBe(360);
    expect(n.productSources?.[0]?.productName).toBe('Newer beans');
  });

  it('is household scoped, and relinking changes the next result (cache keyed on the snapshot version)', () => {
    const store = new InMemoryProductSnapshotStore();
    const c1 = calcFor(store, H1);
    const c2 = calcFor(store, H2);
    const before = c1.forRecipe(recipe()).nutrition.totals.energy_kcal.value;
    link(store, H1, product({ nutriments: { 'energy-kcal_100g': 11 } }));
    expect(c1.forRecipe(recipe()).nutrition.totals.energy_kcal.value).toBe(44);
    expect(c1.forRecipe(recipe()).nutrition.totals.energy_kcal.value).not.toBe(before);
    expect(c2.forRecipe(recipe()).nutrition.productSources).toBeUndefined(); // another household is unaffected
    store.remove(H1, FIXTURE_CODES.bakedBeans);
    expect(c1.forRecipe(recipe()).nutrition.totals.energy_kcal.value).toBe(before);
  });
});
