import 'server-only';
import { ProductSourceError, normaliseBarcode, type Product, type ProductSource } from '@fr/product-sources';
import type { IngredientRef, ScanMatch } from '../../pantry/scan-types';
import type { ProductLookupDto, ProductLookupError } from '../../products/types';
import { getIngredientCatalogue, type IngredientCatalogue } from '../refdata/catalogue';
import { getProductSource, productProviderInfo } from './provider';

export type LookupOutcome =
  | { ok: true; lookup: ProductLookupDto }
  | { ok: false; status: 400 | 404 | 429 | 502 | 504; error: ProductLookupError };

/** Product suggestion -> the pantry review's ScanMatch (canonical ingredient refs with category). */
export function matchForProduct(product: Product, catalogue: IngredientCatalogue = getIngredientCatalogue()): ScanMatch {
  const ref = (id: string): IngredientRef | undefined => {
    const i = catalogue.get(id);
    return i ? { id: i.id, name: i.name, category: i.category } : undefined;
  };
  const s = product.suggestion;
  if (s.status === 'matched') {
    const r = ref(s.ingredientId);
    if (r) return { status: 'matched', ingredient: r };
  }
  if (s.status === 'ambiguous') {
    const candidates = s.candidates.map((c) => ref(c.ingredientId)).filter((r): r is IngredientRef => !!r);
    if (candidates.length > 0) return { status: 'ambiguous', candidates };
  }
  return { status: 'unmatched', suggestions: [] };
}

// ---- per-caller quota: a household cannot starve everyone else of the shared upstream allowance ----

const QUOTA_PER_MINUTE = 30;
const hits = new Map<string, number[]>();

export function withinQuota(key: string, now: number = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= QUOTA_PER_MINUTE) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}
export const resetProductQuota = (): void => hits.clear();

const STATUS: Record<string, 400 | 404 | 429 | 502 | 504> = {
  invalid_barcode: 400, not_found: 404, rate_limited: 429, upstream: 502, bad_response: 502, timeout: 504, disabled: 502,
};

/** Look a barcode up. Never throws: failures are typed outcomes the route and the scan UI can show. */
export async function lookupProduct(
  input: string,
  opts: { source?: ProductSource; catalogue?: IngredientCatalogue; quotaKey?: string } = {},
): Promise<LookupOutcome> {
  const code = normaliseBarcode(String(input ?? ''));
  if (!code) return { ok: false, status: 400, error: { code: 'invalid_barcode', message: 'That is not a valid barcode. Check the digits (8, 12 or 13 numbers).', retryable: false } };
  if (opts.quotaKey && !withinQuota(opts.quotaKey)) {
    return { ok: false, status: 429, error: { code: 'rate_limited', message: 'Too many product lookups. Try again in a minute.', retryable: true } };
  }
  const source = opts.source ?? getProductSource();
  try {
    const product = await source.byBarcode(code);
    if (!product) {
      return { ok: false, status: 404, error: { code: 'not_found', message: 'We could not find that product. Add it by name instead.', retryable: false } };
    }
    return { ok: true, lookup: { product, match: matchForProduct(product, opts.catalogue), provider: productProviderInfo(source) } };
  } catch (e) {
    if (e instanceof ProductSourceError) {
      return { ok: false, status: STATUS[e.code] ?? 502, error: { code: e.code, message: e.message, retryable: e.retryable } };
    }
    return { ok: false, status: 502, error: { code: 'upstream', message: 'The product lookup failed. Please try again.', retryable: true } };
  }
}
