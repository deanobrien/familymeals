// Browser helper: GET /api/products/<barcode>. Never throws.
import type { ProductLookupDto, ProductLookupError } from './types';

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
