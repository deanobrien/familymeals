import { beforeEach, describe, expect, it } from 'vitest';
import { FIXTURE_CODES, MockProductSource } from '@fr/product-sources';
import { getIngredientCatalogue } from '../refdata/catalogue';
import { linkScannedProducts } from './link';
import { lookupProduct, matchForProduct, resetProductQuota, withinQuota } from './lookup';
import { createProductSource, productProviderMode } from './provider';
import { InMemoryProductSnapshotStore } from './store';

const cat = getIngredientCatalogue();
const mock = (opts: ConstructorParameters<typeof MockProductSource>[0] = {}) =>
  new MockProductSource({ matcher: cat.matcher, nameOf: (id) => cat.get(id)?.name, ...opts });
const BEANS = cat.matcher.match('baked beans').ingredientId!;

beforeEach(() => resetProductQuota());

describe('provider selection', () => {
  it('defaults to the offline mock; only PRODUCT_PROVIDER=off is live', () => {
    expect(productProviderMode({})).toBe('mock');
    expect(productProviderMode({ PRODUCT_PROVIDER: 'whatever' })).toBe('mock');
    expect(productProviderMode({ PRODUCT_PROVIDER: ' OFF ' })).toBe('off');
    expect(createProductSource({}).id).toBe('mock');
    const live = createProductSource({ PRODUCT_PROVIDER: 'off', OFF_CONTACT: 'ops@example.invalid' });
    expect(live.id).toBe('open-food-facts');
    expect((live as unknown as { userAgent: string }).userAgent).toBe('FamilyRecipes/0.1 (ops@example.invalid)');
  });
});

describe('lookupProduct', () => {
  it('returns the product with a conservative ingredient match over our catalogue', async () => {
    const out = await lookupProduct(FIXTURE_CODES.bakedBeans, { source: mock() });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.lookup.product.name).toMatch(/Baked Beans/);
    expect(out.lookup.match).toMatchObject({ status: 'matched', ingredient: { id: BEANS, name: 'baked beans' } });
    expect(out.lookup.provider).toEqual({ id: 'mock', isMock: true });
  });

  it('an unmatched product is offered with no pre-selection', async () => {
    const out = await lookupProduct(FIXTURE_CODES.mysterySauce, { source: mock() });
    expect(out.ok && out.lookup.match).toMatchObject({ status: 'unmatched' });
  });

  it('turns every failure into a typed outcome (never throws)', async () => {
    expect(await lookupProduct('123', { source: mock() })).toMatchObject({ ok: false, status: 400, error: { code: 'invalid_barcode', retryable: false } });
    expect(await lookupProduct('4006381333931', { source: mock() })).toMatchObject({ ok: false, status: 404, error: { code: 'not_found' } });
    expect(await lookupProduct(FIXTURE_CODES.bakedBeans, { source: mock({ failWith: 'rate_limited' }) })).toMatchObject({ ok: false, status: 429, error: { retryable: true } });
    expect(await lookupProduct(FIXTURE_CODES.bakedBeans, { source: mock({ failWith: 'upstream' }) })).toMatchObject({ ok: false, status: 502 });
    expect(await lookupProduct(FIXTURE_CODES.bakedBeans, { source: mock({ failWith: 'timeout' }) })).toMatchObject({ ok: false, status: 504 });
    const boom = { id: 'x', byBarcode: async () => { throw new Error('kaboom'); }, search: async () => [] };
    expect(await lookupProduct(FIXTURE_CODES.bakedBeans, { source: boom })).toMatchObject({ ok: false, status: 502, error: { code: 'upstream' } });
  });

  it('enforces a per-household quota without hitting the source', async () => {
    const source = mock();
    for (let i = 0; i < 30; i++) expect(withinQuota('hh1', 1000)).toBe(true);
    expect(withinQuota('hh1', 1000)).toBe(false);
    expect(withinQuota('hh2', 1000)).toBe(true); // other households unaffected
    expect(withinQuota('hh1', 1000 + 61_000)).toBe(true); // window slides
    resetProductQuota();
    for (let i = 0; i < 30; i++) await lookupProduct(FIXTURE_CODES.bakedBeans, { source, quotaKey: 'hh' });
    const blocked = await lookupProduct(FIXTURE_CODES.bakedBeans, { source, quotaKey: 'hh' });
    expect(blocked).toMatchObject({ ok: false, status: 429 });
    expect(source.calls).toHaveLength(30);
  });
});

describe('matchForProduct', () => {
  it('names ambiguous candidates from the catalogue and drops unknown ids', async () => {
    const p = (await mock().byBarcode(FIXTURE_CODES.bakedBeans))!;
    const milk = cat.matcher.match('milk').ingredientId!;
    const ambiguous = { ...p, suggestion: { status: 'ambiguous' as const, candidates: [{ ingredientId: BEANS, ingredientName: 'x' }, { ingredientId: milk, ingredientName: 'y' }, { ingredientId: 'nope', ingredientName: 'z' }], matchedOn: 'q' } };
    const m = matchForProduct(ambiguous, cat);
    expect(m.status).toBe('ambiguous');
    expect(m.status === 'ambiguous' && m.candidates.map((c) => c.name)).toEqual(['baked beans', 'milk']);
    expect(matchForProduct({ ...p, suggestion: { status: 'matched', ingredientId: 'nope', ingredientName: 'n', via: 'name', matchedOn: 'n' } }, cat).status).toBe('unmatched');
  });
});

describe('linkScannedProducts (confirm-to-pantry)', () => {
  const H = 'aa000000-0000-4000-8000-0000000000aa';
  const deps = (store: InMemoryProductSnapshotStore) => ({ source: mock(), store, now: () => new Date('2026-10-19T12:00:00Z') });

  it('stores a server-side snapshot linked to the chosen ingredient, once per barcode', async () => {
    const store = new InMemoryProductSnapshotStore();
    const res = await linkScannedProducts(H, [
      { barcode: FIXTURE_CODES.bakedBeans, ingredientId: BEANS },
      { barcode: FIXTURE_CODES.bakedBeans, ingredientId: BEANS },
    ], deps(store));
    expect(res).toEqual({ linked: 1, skipped: 0 });
    const [snap] = store.list(H);
    expect(snap).toMatchObject({ barcode: FIXTURE_CODES.bakedBeans, ingredientId: BEANS, linkedAt: '2026-10-19T12:00:00.000Z' });
    expect(snap!.product.source.publisher).toBe('Open Food Facts');
    expect(store.list('someone-else')).toEqual([]);
  });

  it('skips free-text rows, rows without a barcode, unknown ingredients and failed lookups', async () => {
    const store = new InMemoryProductSnapshotStore();
    const res = await linkScannedProducts(H, [
      { barcode: FIXTURE_CODES.bakedBeans },
      { ingredientId: BEANS },
      { barcode: FIXTURE_CODES.bakedBeans, ingredientId: 'not-an-ingredient' },
      { barcode: '4006381333931', ingredientId: BEANS }, // not found
    ], deps(store));
    expect(res).toEqual({ linked: 0, skipped: 1 });
    expect(store.list(H)).toEqual([]);
  });
});
