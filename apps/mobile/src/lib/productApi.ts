/**
 * Client for GET /api/products/<barcode> (apps/web, X2/D188): the app sends only the barcode, the household id and the
 * user's Supabase access token; the Open Food Facts lookup, its User-Agent and its rate limits stay on the server.
 */

import type { BatchEntry, BatchOutcome, BatchRequest } from '@fr/engine/pantry';

export const PRODUCT_ATTRIBUTION = 'Product data © Open Food Facts contributors, ODbL';

export class ProductApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ProductApiError';
  }
}

export interface ProductSummary {
  barcode: string;
  name: string;
  brand?: string;
  packSizeText?: string;
  /** What the record says: 'listed' with names, or 'unknown' (never "allergen free"). */
  allergens: { status: 'listed' | 'unknown'; contains: string[]; traces: string[] };
  /** Per-100 g/ml values we can show; unknown nutrients are simply absent (never 0). */
  nutrition: Array<{ label: string; text: string }>;
  /** Canonical ingredient suggestion, if any (display only; the pantry add happens on the web). */
  ingredientName?: string;
  sourceUrl: string;
}

export interface ProductClient {
  readonly configured: boolean;
  lookup(householdId: string, barcode: string): Promise<ProductSummary>;
  /** Continuous scanning (BS1): POST /api/products. Known products answer at once, the rest are queued server side; poll with the still-pending codes. Never throws. */
  lookupBatch(householdId: string, req: BatchRequest): Promise<BatchOutcome<ProductSummary>>;
  webUrl(path: string): string | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

const ALLERGEN: Record<string, string> = {
  celery: 'Celery', cereals_gluten: 'Cereals containing gluten', crustaceans: 'Crustaceans', eggs: 'Eggs', fish: 'Fish',
  lupin: 'Lupin', milk: 'Milk', molluscs: 'Molluscs', mustard: 'Mustard', peanuts: 'Peanuts', sesame: 'Sesame',
  soya: 'Soya', sulphites: 'Sulphites', tree_nuts: 'Tree nuts',
};
const NUTRIENT: Record<string, string> = {
  energy_kcal: 'Energy', protein: 'Protein', carbohydrate: 'Carbohydrate', sugars: 'Sugars', fat: 'Fat',
  saturates: 'Saturates', fibre: 'Fibre', salt: 'Salt',
};

/** Defensive: only what we display is read; unknown shape -> ProductApiError rather than a wrong card. */
export function summariseProduct(body: unknown): ProductSummary {
  const product = isObj(body) && isObj(body.product) ? body.product : undefined;
  if (!product || typeof product.barcode !== 'string' || typeof product.name !== 'string') {
    throw new ProductApiError('The server returned an unexpected response.', 200, false);
  }
  const a = isObj(product.allergens) ? product.allergens : {};
  const nutrition = isObj(product.nutrition) ? product.nutrition : {};
  const per = nutrition.per === 'ml' ? 'ml' : 'g';
  const lines = (Array.isArray(nutrition.per100) ? nutrition.per100 : []).filter(isObj).flatMap((n) => {
    const label = typeof n.nutrient === 'string' ? NUTRIENT[n.nutrient] : undefined;
    if (!label || typeof n.value !== 'number') return [];
    return [{ label, text: `${n.value} ${typeof n.unit === 'string' ? n.unit : ''} per 100 ${per}`.replace('  ', ' ') }];
  });
  const match = isObj(body) && isObj(body.match) && isObj(body.match.ingredient) ? body.match.ingredient : undefined;
  const src = isObj(product.source) && typeof product.source.url === 'string' ? product.source.url : `https://world.openfoodfacts.org/product/${product.barcode}`;
  return {
    barcode: product.barcode,
    name: product.name,
    ...(typeof product.brand === 'string' ? { brand: product.brand } : {}),
    ...(typeof product.packSizeText === 'string' ? { packSizeText: product.packSizeText } : {}),
    allergens: {
      status: a.status === 'listed' ? 'listed' : 'unknown',
      contains: strs(a.contains).map((g) => ALLERGEN[g] ?? g),
      traces: strs(a.traces).map((g) => ALLERGEN[g] ?? g),
    },
    nutrition: lines,
    ...(match && typeof match.name === 'string' ? { ingredientName: match.name } : {}),
    sourceUrl: src,
  };
}

export function createProductClient(opts: {
  baseUrl?: string | undefined;
  getToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}): ProductClient {
  const base = opts.baseUrl?.trim().replace(/\/+$/, '') || undefined;
  const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  return {
    configured: !!base,
    webUrl: (path) => (base ? `${base}${path.startsWith('/') ? '' : '/'}${path}` : null),
    async lookupBatch(householdId, req) {
      if (!base) return { ok: false, fatal: true, message: 'Barcode lookup is not set up (EXPO_PUBLIC_API_BASE_URL is empty).' };
      const token = await opts.getToken();
      const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      try {
        const res = await doFetch(`${base}/api/products`, { method: 'POST', headers, body: JSON.stringify({ ...req, householdId }) });
        if (res.status === 401 || res.status === 403) return { ok: false, fatal: true, message: 'The server did not accept your sign-in. Sign in again, or use the web app.' };
        const json = (await res.json().catch(() => null)) as { results?: Record<string, BatchEntry<unknown>> } | null;
        if (!res.ok || !json?.results || !isObj(json.results)) return { ok: false, fatal: false, message: `HTTP ${res.status}` };
        const results: Record<string, BatchEntry<ProductSummary>> = {};
        for (const [code, e] of Object.entries(json.results)) {
          if (e.status === 'done') {
            try {
              results[code] = { status: 'done', lookup: summariseProduct(e.lookup) };
            } catch {
              results[code] = { status: 'error', error: { code: 'bad_response', message: 'The server returned an unexpected response.', retryable: false } };
            }
          } else results[code] = e as BatchEntry<ProductSummary>;
        }
        return { ok: true, results };
      } catch {
        return { ok: false, fatal: false, message: 'network' };
      }
    },
    async lookup(householdId, barcode) {
      if (!base) throw new ProductApiError('Barcode lookup is not set up (EXPO_PUBLIC_API_BASE_URL is empty).', 0, false);
      const token = await opts.getToken();
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      let res: Response;
      try {
        res = await doFetch(`${base}/api/products/${encodeURIComponent(barcode)}?householdId=${encodeURIComponent(householdId)}`, { headers });
      } catch {
        throw new ProductApiError('Could not reach the server. Check your connection and try again.', 0, true);
      }
      if (!res.ok) {
        let message = `The product lookup failed (HTTP ${res.status}).`;
        let code: string | undefined;
        let retryable = res.status >= 500 || res.status === 429;
        try {
          const j = (await res.json()) as { error?: { code?: string; message?: string; retryable?: boolean } };
          if (j.error?.message) message = j.error.message;
          code = j.error?.code;
          if (typeof j.error?.retryable === 'boolean') retryable = j.error.retryable;
        } catch {
          /* non-JSON body */
        }
        if (res.status === 401 || res.status === 403) message = 'The server did not accept your sign-in. Sign in again, or use the web app.';
        throw new ProductApiError(message, res.status, retryable, code);
      }
      return summariseProduct(await res.json());
    },
  };
}
