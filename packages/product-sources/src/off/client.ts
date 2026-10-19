import { normaliseBarcode } from '../barcode';
import { ProductSourceError, type Product, type ProductSource, type SearchOptions } from '../types';
import { mapOffProduct, type MapOptions } from './map';
import { OffProductResponse, OffSearchResponse } from './schema';

/**
 * Open Food Facts adapter (D180-D185). Server-side only.
 *  - GET {base}/api/v2/product/{code}.json?fields=...  (product reads: 15/min per IP upstream)
 *  - GET {base}/cgi/search.pl?...&json=1               (search: 10/min per IP upstream; never search-as-you-type)
 * We stay under those limits with a sliding-window limiter (default 10 reads/min, 5 searches/min), cache hits and
 * misses, and identify ourselves with "FamilyRecipes/0.1 (<OFF_CONTACT>)". Over-limit requests fail fast with a
 * retryable `rate_limited` error instead of queueing for minutes.
 */

export const OFF_FIELDS = [
  'code', 'product_name', 'product_name_en', 'generic_name', 'brands', 'quantity', 'product_quantity',
  'product_quantity_unit', 'nutriments', 'allergens_tags', 'traces_tags', 'ingredients_text', 'categories_tags',
  'image_front_url', 'image_front_small_url',
].join(',');

const COUNTRY_SLUGS: Record<string, string> = { uk: 'united-kingdom', gb: 'united-kingdom', ie: 'ireland', us: 'united-states', fr: 'france', de: 'germany' };

export interface OffClientOptions extends MapOptions {
  /** Contact for the User-Agent. Defaults to env OFF_CONTACT. */
  contact?: string;
  fetch?: typeof fetch;
  baseUrl?: string;
  sleep?: (ms: number) => Promise<void>;
  productsPerMinute?: number;
  searchesPerMinute?: number;
  /** Longest a call may wait for a rate-limit slot before failing with `rate_limited`. */
  maxWaitMs?: number;
  timeoutMs?: number;
  productTtlMs?: number;
  missTtlMs?: number;
  searchTtlMs?: number;
}

class SlidingWindow {
  private stamps: number[] = [];
  private chain: Promise<void> = Promise.resolve();
  constructor(
    private readonly limit: number,
    private readonly now: () => number,
    private readonly sleep: (ms: number) => Promise<void>,
    private readonly maxWaitMs: number,
  ) {}
  /** Reserve a slot, waiting up to maxWaitMs for one. Serialised so concurrent callers queue fairly. */
  acquire(): Promise<void> {
    const run = this.chain.then(async () => {
      for (;;) {
        const t = this.now();
        this.stamps = this.stamps.filter((s) => t - s < 60_000);
        if (this.stamps.length < this.limit) {
          this.stamps.push(t);
          return;
        }
        const wait = this.stamps[0]! + 60_000 - t;
        if (wait > this.maxWaitMs) throw new ProductSourceError('rate_limited', 'Product lookups are busy. Try again in a minute.', true);
        await this.sleep(wait);
      }
    });
    this.chain = run.catch(() => undefined);
    return run;
  }
}

interface CacheEntry<T> { at: number; value: T }

export class OpenFoodFactsSource implements ProductSource {
  readonly id = 'open-food-facts';
  private readonly fetchFn: typeof fetch;
  private readonly base: string;
  private readonly ua: string;
  private readonly nowMs: () => number;
  private readonly reads: SlidingWindow;
  private readonly searches: SlidingWindow;
  private readonly products = new Map<string, CacheEntry<Product | null>>();
  private readonly searchCache = new Map<string, CacheEntry<Product[]>>();
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(private readonly opts: OffClientOptions = {}) {
    this.fetchFn = opts.fetch ?? ((...a) => fetch(...a));
    this.base = (opts.baseUrl ?? 'https://world.openfoodfacts.org').replace(/\/$/, '');
    const contact = opts.contact ?? process.env.OFF_CONTACT ?? 'contact-not-configured';
    this.ua = `FamilyRecipes/0.1 (${contact})`;
    this.nowMs = () => (opts.now ?? (() => new Date()))().getTime();
    const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const maxWait = opts.maxWaitMs ?? 4000;
    this.reads = new SlidingWindow(opts.productsPerMinute ?? 10, this.nowMs, sleep, maxWait);
    this.searches = new SlidingWindow(opts.searchesPerMinute ?? 5, this.nowMs, sleep, maxWait);
  }

  get userAgent(): string {
    return this.ua;
  }

  private fresh<T>(entry: CacheEntry<T> | undefined, ttl: number): entry is CacheEntry<T> {
    return !!entry && this.nowMs() - entry.at < ttl;
  }

  private dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const hit = this.inflight.get(key) as Promise<T> | undefined;
    if (hit) return hit;
    const p = fn().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private async getJson(url: string): Promise<unknown> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.opts.timeoutMs ?? 8000);
    try {
      const res = await this.fetchFn(url, { headers: { 'User-Agent': this.ua, Accept: 'application/json' }, signal: ctl.signal });
      if (res.status === 429) throw new ProductSourceError('rate_limited', 'The product database asked us to slow down. Try again shortly.', true);
      if (res.status >= 500) throw new ProductSourceError('upstream', 'The product database is unavailable right now.', true);
      // 404 with a JSON body is how v2 reports "not found"; let the caller read the body.
      if (!res.ok && res.status !== 404) throw new ProductSourceError('upstream', `The product database answered ${res.status}.`, false);
      try {
        return await res.json();
      } catch {
        if (res.status === 404) return { status: 0 };
        throw new ProductSourceError('bad_response', 'The product database sent an unreadable answer.', true);
      }
    } catch (e) {
      if (e instanceof ProductSourceError) throw e;
      if (e instanceof Error && e.name === 'AbortError') throw new ProductSourceError('timeout', 'The product database took too long to answer.', true);
      throw new ProductSourceError('upstream', 'Could not reach the product database.', true);
    } finally {
      clearTimeout(timer);
    }
  }

  async byBarcode(input: string): Promise<Product | null> {
    const code = normaliseBarcode(input);
    if (!code) throw new ProductSourceError('invalid_barcode', 'That is not a valid barcode (EAN-8, EAN-13 or UPC-A).');
    const cached = this.products.get(code);
    if (this.fresh(cached, cached?.value ? (this.opts.productTtlMs ?? 24 * 3600_000) : (this.opts.missTtlMs ?? 3600_000))) return cached.value;
    return this.dedupe(`p:${code}`, async () => {
      await this.reads.acquire();
      const json = await this.getJson(`${this.base}/api/v2/product/${code}.json?fields=${OFF_FIELDS}`);
      const parsed = OffProductResponse.safeParse(json);
      if (!parsed.success) throw new ProductSourceError('bad_response', 'The product database sent an unexpected answer.', true);
      const found = Number(parsed.data.status) === 1 && parsed.data.product;
      const value = found ? mapOffProduct(code, parsed.data.product!, this.opts) : null;
      this.products.set(code, { at: this.nowMs(), value });
      return value;
    });
  }

  async search(query: string, options?: SearchOptions | string): Promise<Product[]> {
    const o: SearchOptions = typeof options === 'string' ? { country: options } : (options ?? {});
    const q = query.trim().replace(/\s+/g, ' ').slice(0, 100);
    if (q.length < 3) return [];
    const country = (o.country ?? 'uk').toLowerCase();
    const limit = Math.min(Math.max(o.limit ?? 10, 1), 20);
    const key = `${country}|${limit}|${q.toLowerCase()}`;
    const cached = this.searchCache.get(key);
    if (this.fresh(cached, this.opts.searchTtlMs ?? 3600_000)) return cached.value;
    return this.dedupe(`s:${key}`, async () => {
      await this.searches.acquire();
      const params = new URLSearchParams({
        search_terms: q, search_simple: '1', action: 'process', json: '1', page_size: String(limit), fields: OFF_FIELDS,
        tagtype_0: 'countries', tag_contains_0: 'contains', tag_0: COUNTRY_SLUGS[country] ?? country,
      });
      const json = await this.getJson(`${this.base}/cgi/search.pl?${params.toString()}`);
      const parsed = OffSearchResponse.safeParse(json);
      if (!parsed.success) throw new ProductSourceError('bad_response', 'The product database sent an unexpected answer.', true);
      const out: Product[] = [];
      for (const raw of parsed.data.products) {
        const code = raw.code ? normaliseBarcode(raw.code) : null;
        if (!code) continue;
        const p = mapOffProduct(code, raw, this.opts);
        if (p) out.push(p);
      }
      this.searchCache.set(key, { at: this.nowMs(), value: out });
      return out;
    });
  }
}
