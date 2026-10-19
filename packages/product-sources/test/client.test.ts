import { describe, expect, it, vi } from 'vitest';
import { FIXTURE_CODES, OFF_FIXTURES, OpenFoodFactsSource } from '../src';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const found = (code: string) => json({ code, status: 1, product: OFF_FIXTURES[code] });

function setup(handler: (url: string, init: RequestInit) => Response | Promise<Response>, extra: Record<string, unknown> = {}) {
  let t = Date.parse('2026-10-19T12:00:00Z');
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => handler(String(url), init ?? {}));
  const sleeps: number[] = [];
  const source = new OpenFoodFactsSource({
    fetch: fetch as unknown as typeof globalThis.fetch,
    contact: 'test@example.invalid',
    now: () => new Date(t),
    sleep: async (ms) => { sleeps.push(ms); t += ms; },
    ...extra,
  });
  return { source, fetch, sleeps, advance: (ms: number) => { t += ms; } };
}

describe('OpenFoodFactsSource', () => {
  it('calls the v2 product endpoint with a proper User-Agent and field list', async () => {
    const { source, fetch } = setup(() => found(FIXTURE_CODES.bakedBeans));
    const p = await source.byBarcode(FIXTURE_CODES.bakedBeans);
    expect(p?.name).toMatch(/Baked Beans/);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toContain(`/api/v2/product/${FIXTURE_CODES.bakedBeans}.json?fields=`);
    expect((init!.headers as Record<string, string>)['User-Agent']).toBe('FamilyRecipes/0.1 (test@example.invalid)');
  });

  it('uses env OFF_CONTACT, with a visible placeholder when it is not set', () => {
    const prev = process.env.OFF_CONTACT;
    delete process.env.OFF_CONTACT;
    expect(new OpenFoodFactsSource().userAgent).toBe('FamilyRecipes/0.1 (contact-not-configured)');
    process.env.OFF_CONTACT = 'ops@example.invalid';
    expect(new OpenFoodFactsSource().userAgent).toBe('FamilyRecipes/0.1 (ops@example.invalid)');
    if (prev === undefined) delete process.env.OFF_CONTACT;
    else process.env.OFF_CONTACT = prev;
  });

  it('rejects an invalid barcode without a request', async () => {
    const { source, fetch } = setup(() => found(FIXTURE_CODES.bakedBeans));
    await expect(source.byBarcode('1234')).rejects.toMatchObject({ code: 'invalid_barcode' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('caches hits and misses, and dedupes concurrent calls', async () => {
    const { source, fetch, advance } = setup((url) => (url.includes(FIXTURE_CODES.bakedBeans) ? found(FIXTURE_CODES.bakedBeans) : json({ status: 0, status_verbose: 'product not found' }, 404)));
    await Promise.all([source.byBarcode(FIXTURE_CODES.bakedBeans), source.byBarcode(FIXTURE_CODES.bakedBeans)]);
    await source.byBarcode(FIXTURE_CODES.bakedBeans);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await source.byBarcode(FIXTURE_CODES.springWater)).toBeNull();
    await source.byBarcode(FIXTURE_CODES.springWater);
    expect(fetch).toHaveBeenCalledTimes(2);
    advance(2 * 3600_000); // miss TTL (1h) passed
    await source.byBarcode(FIXTURE_CODES.springWater);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('stays under the rate limit: waits for a slot, or fails fast with a retryable error', async () => {
    const { source, sleeps } = setup(() => found(FIXTURE_CODES.bakedBeans), { productsPerMinute: 2, maxWaitMs: 70_000 });
    for (const c of [FIXTURE_CODES.bakedBeans, FIXTURE_CODES.springWater, FIXTURE_CODES.yogurtMultipack]) await source.byBarcode(c);
    expect(sleeps).toEqual([60_000]);

    const strict = setup(() => found(FIXTURE_CODES.bakedBeans), { productsPerMinute: 1, maxWaitMs: 1000 });
    await strict.source.byBarcode(FIXTURE_CODES.bakedBeans);
    await expect(strict.source.byBarcode(FIXTURE_CODES.springWater)).rejects.toMatchObject({ code: 'rate_limited', retryable: true });
  });

  it('maps HTTP failures to typed errors', async () => {
    const code = FIXTURE_CODES.bakedBeans;
    await expect(setup(() => json({}, 429)).source.byBarcode(code)).rejects.toMatchObject({ code: 'rate_limited', retryable: true });
    await expect(setup(() => json({}, 503)).source.byBarcode(code)).rejects.toMatchObject({ code: 'upstream', retryable: true });
    await expect(setup(() => json({}, 403)).source.byBarcode(code)).rejects.toMatchObject({ code: 'upstream', retryable: false });
    await expect(setup(() => { throw new TypeError('network down'); }).source.byBarcode(code)).rejects.toMatchObject({ code: 'upstream' });
    await expect(setup(() => json({ status: 1, product: { nutriments: 'nope' } })).source.byBarcode(code)).rejects.toMatchObject({ code: 'bad_response' });
    await expect(setup(() => new Response('<html>', { status: 200 })).source.byBarcode(code)).rejects.toMatchObject({ code: 'bad_response' });
  });

  it('times out slow answers', async () => {
    const { source } = setup(
      (_u, init) => new Promise<Response>((_res, rej) => { init.signal!.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))); }),
      { timeoutMs: 10 },
    );
    await expect(source.byBarcode(FIXTURE_CODES.bakedBeans)).rejects.toMatchObject({ code: 'timeout' });
  });

  it('searches UK products, skips junk rows, and caches', async () => {
    const { source, fetch } = setup(() => json({ count: 3, products: [OFF_FIXTURES[FIXTURE_CODES.yogurtMultipack], { code: 'not-a-code', product_name: 'junk' }, OFF_FIXTURES[FIXTURE_CODES.noName]] }));
    const out = await source.search('natural yogurt');
    expect(out.map((p) => p.barcode)).toEqual([FIXTURE_CODES.yogurtMultipack]);
    const url = String(fetch.mock.calls[0]![0]);
    expect(url).toContain('/cgi/search.pl?');
    expect(url).toContain('json=1');
    expect(url).toContain('tag_0=united-kingdom');
    await source.search('natural yogurt');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await source.search('ab')).toEqual([]);
  });
});
