import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FIXTURE_CODES, MockProductSource } from '@fr/product-sources';
import { getIngredientCatalogue } from '../refdata/catalogue';
import { LruCache, ProductBatchResolver, householdSnapshotLookup, resetPollRate, withinPollRate, type ResolverDeps } from './batch';
import { lookupProduct, type LookupOutcome } from './lookup';
import { InMemoryProductSnapshotStore } from './store';

const cat = getIngredientCatalogue();
const source = new MockProductSource({ matcher: cat.matcher, nameOf: (id) => cat.get(id)?.name });
const real = (code: string) => lookupProduct(code, { source });
const BEANS = FIXTURE_CODES.bakedBeans;
const FUSILLI = FIXTURE_CODES.wholewheatFusilli;
const TOMATOES = FIXTURE_CODES.choppedTomatoes;
const NOT_IN_FIXTURES = '4006381333931';

function make(over: Partial<ResolverDeps> = {}) {
  const lookup = vi.fn(real);
  const sleeps: number[] = [];
  const r = new ProductBatchResolver({
    lookup, snapshot: async () => null, sleep: async (ms) => { sleeps.push(ms); }, retryDelayMs: 10, ...over,
  });
  return { r, lookup, sleeps };
}

beforeEach(() => resetPollRate());

describe('LruCache', () => {
  it('evicts the least recently used entry and expires by time', () => {
    let t = 0;
    const c = new LruCache<number>(2, 100, () => t);
    c.set('a', 1); c.set('b', 2);
    expect(c.get('a')).toBe(1); // a is now most recent
    c.set('c', 3);
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBe(1);
    t = 150;
    expect(c.get('a')).toBeUndefined();
    expect(c.size).toBe(1); // only c left in the map (a was dropped on read)
  });
});

describe('ProductBatchResolver', () => {
  it('queues unknown codes as pending, resolves them in the background, then answers instantly from the cache', async () => {
    const { r, lookup } = make();
    const first = await r.resolve('hh1', [BEANS, FUSILLI]);
    expect(first[BEANS]).toEqual({ status: 'pending' });
    expect(first[FUSILLI]).toEqual({ status: 'pending' });
    await r.drain();
    expect(lookup).toHaveBeenCalledTimes(2);
    const second = await r.resolve('hh1', [BEANS, FUSILLI]);
    expect(second[BEANS]).toMatchObject({ status: 'done', lookup: { product: { barcode: BEANS }, match: { status: 'matched' } } });
    expect(second[FUSILLI]).toMatchObject({ status: 'done' });
    expect(lookup).toHaveBeenCalledTimes(2); // nothing new upstream
  });

  it('another household gets a cached product without another upstream call', async () => {
    const { r, lookup } = make();
    await r.resolve('hh1', [BEANS]);
    await r.drain();
    const other = await r.resolve('hh2', [BEANS]);
    expect(other[BEANS]).toMatchObject({ status: 'done' });
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("a household's own snapshot resolves instantly, linked to its chosen ingredient, with no upstream call", async () => {
    const store = new InMemoryProductSnapshotStore();
    const out = await real(TOMATOES);
    if (!out.ok) throw new Error('fixture');
    const linked = cat.matcher.match('baked beans').ingredientId!;
    store.save('hh1', { barcode: TOMATOES, ingredientId: linked, product: out.lookup.product, linkedAt: '2026-10-20T00:00:00Z' });
    const snapshot = async (hh: string, code: string) => {
      const s = store.list(hh).find((x) => x.barcode === code);
      if (!s) return null;
      const ing = cat.get(s.ingredientId!)!;
      return { product: s.product, match: { status: 'matched' as const, ingredient: { id: ing.id, name: ing.name, category: ing.category } }, provider: { id: 'household', isMock: false } };
    };
    const { r, lookup } = make({ snapshot });
    const res = await r.resolve('hh1', [TOMATOES]);
    expect(res[TOMATOES]).toMatchObject({ status: 'done', lookup: { match: { status: 'matched', ingredient: { id: linked } }, provider: { id: 'household' } } });
    expect(lookup).not.toHaveBeenCalled();
    // ...but it is that household's only: hh2 has to look it up.
    const other = await r.resolve('hh2', [TOMATOES]);
    expect(other[TOMATOES]).toEqual({ status: 'pending' });
  });

  it('householdSnapshotLookup reads the default store and links the chosen ingredient', async () => {
    // default in-memory store: empty for an unknown household => null (no throw)
    expect(await householdSnapshotLookup('hh-none', BEANS)).toBeNull();
  });

  it('reports not found, invalid and failed codes distinctly', async () => {
    const { r } = make();
    const res = await r.resolve('hh1', [NOT_IN_FIXTURES, '1234', '5009000000011']);
    expect(res['1234']).toMatchObject({ status: 'error', error: { code: 'invalid_barcode', retryable: false } });
    expect(res['5009000000011']).toMatchObject({ status: 'error', error: { code: 'invalid_barcode' } });
    expect(res[NOT_IN_FIXTURES]).toEqual({ status: 'pending' });
    await r.drain();
    expect((await r.resolve('hh1', [NOT_IN_FIXTURES]))[NOT_IN_FIXTURES]).toEqual({ status: 'notfound' });
  });

  it('waits out a rate-limited answer and retries instead of failing', async () => {
    let n = 0;
    const lookup = vi.fn(async (code: string): Promise<LookupOutcome> => {
      if (++n <= 2) return { ok: false, status: 429, error: { code: 'rate_limited', message: 'slow down', retryable: true } };
      return real(code);
    });
    const { r, sleeps } = make({ lookup });
    await r.resolve('hh1', [BEANS]);
    await r.drain();
    expect(lookup).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([10, 10]);
    expect((await r.resolve('hh1', [BEANS]))[BEANS]).toMatchObject({ status: 'done' });
  });

  it('gives up after maxAttempts with a retryable error that a retry request clears', async () => {
    let limited = true;
    const lookup = vi.fn(async (code: string): Promise<LookupOutcome> =>
      limited ? { ok: false, status: 429, error: { code: 'rate_limited', message: 'slow down', retryable: true } } : real(code));
    const { r } = make({ lookup, maxAttempts: 3 });
    await r.resolve('hh1', [BEANS]);
    await r.drain();
    const failed = await r.resolve('hh1', [BEANS]);
    expect(failed[BEANS]).toMatchObject({ status: 'error', error: { code: 'rate_limited', retryable: true } });
    limited = false;
    const retried = await r.resolve('hh1', [BEANS], [BEANS]);
    expect(retried[BEANS]).toEqual({ status: 'pending' });
    await r.drain();
    expect((await r.resolve('hh1', [BEANS]))[BEANS]).toMatchObject({ status: 'done' });
  });

  it('a hard upstream error becomes a per-code error without blocking the rest of the queue', async () => {
    const lookup = vi.fn(async (code: string): Promise<LookupOutcome> =>
      code === BEANS ? { ok: false, status: 502, error: { code: 'upstream', message: 'down', retryable: true } } : real(code));
    const { r } = make({ lookup });
    await r.resolve('hh1', [BEANS, FUSILLI]);
    await r.drain();
    const res = await r.resolve('hh1', [BEANS, FUSILLI]);
    expect(res[BEANS]).toMatchObject({ status: 'error', error: { code: 'upstream' } });
    expect(res[FUSILLI]).toMatchObject({ status: 'done' });
  });

  it('round-robins between households so a big queue cannot starve a small one', async () => {
    const order: string[] = [];
    const lookup = vi.fn(async (code: string) => { order.push(code); return real(code); });
    const { r } = make({ lookup });
    const many = [BEANS, FUSILLI, TOMATOES, FIXTURE_CODES.semiSkimmedMilk, FIXTURE_CODES.springWater];
    await r.resolve('big', many);
    await r.resolve('small', [FIXTURE_CODES.yogurtMultipack]);
    await r.drain();
    // The worker had already taken the first of "big"'s codes; "small" is served before big's second half finishes.
    expect(order.indexOf(FIXTURE_CODES.yogurtMultipack)).toBeLessThanOrEqual(2);
    expect(order).toHaveLength(6);
  });

  it('caps the queue per household', async () => {
    const { r } = make({ maxQueuePerHousehold: 2, lookup: vi.fn(() => new Promise<LookupOutcome>(() => undefined)) });
    const res = await r.resolve('hh1', [BEANS, FUSILLI, TOMATOES]);
    expect(res[TOMATOES]).toMatchObject({ status: 'error', error: { code: 'rate_limited', retryable: true } });
    expect(r.pendingFor('hh1')).toBe(2);
  });

  it('a snapshot failure is treated as "not known", not an error', async () => {
    const { r } = make({ snapshot: async () => { throw new Error('db down'); } });
    expect((await r.resolve('hh1', [BEANS]))[BEANS]).toEqual({ status: 'pending' });
    await r.drain();
  });
});

describe('withinPollRate', () => {
  it('allows a normal polling pace and stops a runaway client', () => {
    for (let i = 0; i < 150; i++) expect(withinPollRate('k', 1000 + i)).toBe(true);
    expect(withinPollRate('k', 2000)).toBe(false);
    expect(withinPollRate('k', 62_000)).toBe(true);
  });
});
