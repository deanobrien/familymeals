import type { ZodType } from 'zod';
import { createRateLimiter, TtlCache } from '../cache.js';
import { DEFAULT_LIMIT, RecipeSourceError, type RecipeSource, type SearchFilters, type SourceRecipe } from '../types.js';
import { FilterResponseSchema, ListResponseSchema, MealsResponseSchema, normaliseMeal } from './schema.js';

export interface TheMealDbOptions {
  /** API key. '1' is the published test key (development / educational use only; see DECISIONS D170). */
  apiKey?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Cache lifetime for responses (default 10 minutes: short, so edits at the publisher show up). */
  ttlMs?: number;
  /** Minimum gap between outgoing requests (default 250 ms = 4 req/s; the publisher states no limit). */
  minIntervalMs?: number;
  /** Per-request timeout. */
  timeoutMs?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

const eq = (a: string | undefined, b: string): boolean => (a ?? '').trim().toLowerCase() === b.trim().toLowerCase();

/** Server-only adapter for TheMealDB v1. The key is only ever used to build the request URL on the server. */
export class TheMealDbSource implements RecipeSource {
  readonly name = 'TheMealDB';
  private readonly base: string;
  private readonly doFetch: typeof fetch;
  private readonly cache: TtlCache<unknown>;
  private readonly limit: <T>(fn: () => Promise<T>) => Promise<T>;
  private readonly timeoutMs: number;

  constructor(opts: TheMealDbOptions = {}) {
    const key = (opts.apiKey ?? '1').trim() || '1';
    this.base = `${(opts.baseUrl ?? 'https://www.themealdb.com/api/json/v1').replace(/\/+$/, '')}/${encodeURIComponent(key)}`;
    this.doFetch = opts.fetch ?? fetch;
    this.cache = new TtlCache<unknown>(opts.ttlMs ?? 10 * 60_000);
    this.limit = createRateLimiter(opts.minIntervalMs ?? 250, opts.sleep ? { sleep: opts.sleep } : {});
    this.timeoutMs = opts.timeoutMs ?? 8000;
  }

  private async get<T>(path: string, params: Record<string, string>, schema: ZodType<T>, useCache = true): Promise<T> {
    const qs = new URLSearchParams(params).toString();
    const url = `${this.base}/${path}${qs ? `?${qs}` : ''}`;
    const hit = useCache ? this.cache.get(url) : undefined;
    if (hit !== undefined) return hit as T;
    let body: unknown;
    try {
      body = await this.limit(async () => {
        const res = await this.doFetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(this.timeoutMs) });
        if (res.status === 429) throw new RecipeSourceError('RATE_LIMITED', 'The recipe source asked us to slow down. Try again in a minute.');
        if (!res.ok) throw new RecipeSourceError('UNAVAILABLE', `The recipe source returned HTTP ${res.status}.`);
        // The free tier answers some misses with an empty body rather than {"meals":null}.
        const text = await res.text();
        return text.trim() ? (JSON.parse(text) as unknown) : { meals: null };
      });
    } catch (e) {
      if (e instanceof RecipeSourceError) throw e;
      throw new RecipeSourceError('UNAVAILABLE', 'The recipe source could not be reached.');
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new RecipeSourceError('BAD_RESPONSE', 'The recipe source sent something we could not read.');
    if (useCache) this.cache.set(url, parsed.data);
    return parsed.data;
  }

  private async meals(path: string, params: Record<string, string>, useCache = true): Promise<SourceRecipe[]> {
    const r = await this.get(path, params, MealsResponseSchema, useCache);
    return (r.meals ?? []).map((m) => normaliseMeal(m)).filter((m): m is SourceRecipe => m !== null);
  }

  /** filter.php gives only id/title/thumb, so fetch details (cached, rate limited) for up to `limit` of them. */
  private async hydrate(ids: string[], limit: number): Promise<SourceRecipe[]> {
    const out: SourceRecipe[] = [];
    for (const id of ids.slice(0, limit)) {
      const m = await this.byId(id);
      if (m) out.push(m);
    }
    return out;
  }

  async byId(id: string): Promise<SourceRecipe | null> {
    if (!/^\d{1,12}$/.test(id)) return null;
    return (await this.meals('lookup.php', { i: id }))[0] ?? null;
  }

  async random(): Promise<SourceRecipe | null> {
    // Never cached: each call should be a fresh dish.
    return (await this.meals('random.php', {}, false))[0] ?? null;
  }

  private async filtered(param: 'i' | 'c' | 'a', value: string, limit: number): Promise<SourceRecipe[]> {
    const v = value.trim();
    if (!v) return [];
    const r = await this.get('filter.php', { [param]: param === 'i' ? v.replace(/\s+/g, '_') : v }, FilterResponseSchema);
    return this.hydrate((r.meals ?? []).map((m) => m.idMeal), limit);
  }

  byIngredient(name: string, limit = DEFAULT_LIMIT) { return this.filtered('i', name, limit); }
  byCategory(category: string, limit = DEFAULT_LIMIT) { return this.filtered('c', category, limit); }
  byArea(area: string, limit = DEFAULT_LIMIT) { return this.filtered('a', area, limit); }

  async search(q: string, filters: SearchFilters = {}): Promise<SourceRecipe[]> {
    const limit = Math.max(1, Math.min(filters.limit ?? DEFAULT_LIMIT, 30));
    const query = q.trim();
    let pool: SourceRecipe[];
    if (query) {
      pool = await this.meals('search.php', { s: query });
    } else if (filters.ingredient?.trim()) {
      pool = await this.byIngredient(filters.ingredient, 30);
    } else if (filters.category?.trim()) {
      pool = await this.byCategory(filters.category, 30);
    } else if (filters.area?.trim()) {
      pool = await this.byArea(filters.area, 30);
    } else {
      return [];
    }
    // Remaining filters are applied to the full records (the free key supports one filter per request).
    const out = pool.filter((m) =>
      (!filters.area?.trim() || eq(m.area, filters.area)) &&
      (!filters.category?.trim() || eq(m.category, filters.category)) &&
      (!filters.ingredient?.trim() || m.ingredients.some((i) => i.name.toLowerCase().includes(filters.ingredient!.trim().toLowerCase()))));
    return out.slice(0, limit);
  }

  private async names(param: 'c' | 'a', key: 'strCategory' | 'strArea'): Promise<string[]> {
    const r = await this.get('list.php', { [param]: 'list' }, ListResponseSchema);
    return (r.meals ?? []).map((m) => m[key]).filter((x): x is string => !!x).sort((a, b) => a.localeCompare(b));
  }
  categories() { return this.names('c', 'strCategory'); }
  areas() { return this.names('a', 'strArea'); }
}
