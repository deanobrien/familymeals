// Browser helper: GET /api/products/<barcode>. Never throws.
import type { BatchEntry, BatchOutcome } from '@fr/engine/pantry';
import type { ProductLookupDto, ProductLookupError } from './types';

/**
 * POST /api/products: the batch lookup behind rapid scanning (BS1, D272). Never throws. A 401/403 is `fatal` (the session
 * is gone: stop polling and say so); a 429, 5xx or a network failure is not (the tracker backs off and keeps the codes).
 */
export async function postBatch(
  req: { codes: string[]; retry?: string[] },
  fetchFn: typeof fetch = (...a) => fetch(...a),
): Promise<BatchOutcome<ProductLookupDto>> {
  try {
    const res = await fetchFn('/api/products', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (res.status === 401 || res.status === 403) return { ok: false, fatal: true, message: 'You are signed out. Sign in again to look products up.' };
    const json = (await res.json().catch(() => null)) as { results?: Record<string, BatchEntry<ProductLookupDto>> } | null;
    if (!res.ok || !json?.results) return { ok: false, fatal: false, message: `HTTP ${res.status}` };
    return { ok: true, results: json.results };
  } catch {
    return { ok: false, fatal: false, message: 'network' };
  }
}

export async function fetchProduct(
  barcode: string,
  fetchFn: typeof fetch = (...a) => fetch(...a),
): Promise<{ ok: true; data: ProductLookupDto } | { ok: false; error: ProductLookupError }> {
  const code = barcode.replace(/[\s-]/g, '');
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) {
    return { ok: false, error: { code: 'invalid_barcode', message: 'Enter the 8, 12 or 13 digits printed under the barcode.', retryable: false } };
  }
  try {
    const res = await fetchFn(`/api/products/${code}`);
    const json = (await res.json().catch(() => null)) as (Partial<ProductLookupDto> & { error?: ProductLookupError }) | null;
    if (!res.ok || !json || !json.product) {
      return { ok: false, error: json?.error ?? { code: 'UNEXPECTED', message: 'The product lookup failed. Please try again.', retryable: true } };
    }
    return { ok: true, data: json as ProductLookupDto };
  } catch {
    return { ok: false, error: { code: 'NETWORK', message: 'We could not reach the server. Check your connection and try again.', retryable: true } };
  }
}
