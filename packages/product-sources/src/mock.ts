import { normaliseBarcode } from './barcode';
import { OFF_FIXTURES } from './fixtures';
import { mapOffProduct, type MapOptions } from './off/map';
import type { OffProduct } from './off/schema';
import { ProductSourceError, type Product, type ProductSource, type ProductErrorCode, type SearchOptions } from './types';

export interface MockProductOptions extends MapOptions {
  /** Raw Open Food Facts-shaped records by barcode. Defaults to the UK fixtures. */
  records?: Record<string, OffProduct>;
  /** Make every call fail (for error-path tests). */
  failWith?: ProductErrorCode;
}

/** Offline provider: the fixtures run through the SAME mapper as live data, so mapping bugs cannot hide here. */
export class MockProductSource implements ProductSource {
  readonly id = 'mock';
  readonly calls: string[] = [];
  constructor(private readonly opts: MockProductOptions = {}) {}

  private records(): Record<string, OffProduct> {
    return this.opts.records ?? OFF_FIXTURES;
  }

  async byBarcode(input: string): Promise<Product | null> {
    this.calls.push(input);
    if (this.opts.failWith) throw new ProductSourceError(this.opts.failWith, 'Mock failure.', true);
    const code = normaliseBarcode(input);
    if (!code) throw new ProductSourceError('invalid_barcode', 'That is not a valid barcode (EAN-8, EAN-13 or UPC-A).');
    const raw = this.records()[code];
    return raw ? mapOffProduct(code, raw, this.opts) : null;
  }

  async search(query: string, options?: SearchOptions | string): Promise<Product[]> {
    this.calls.push(`search:${query}`);
    if (this.opts.failWith) throw new ProductSourceError(this.opts.failWith, 'Mock failure.', true);
    const limit = typeof options === 'object' ? (options.limit ?? 10) : 10;
    const q = query.trim().toLowerCase();
    if (q.length < 3) return [];
    const out: Product[] = [];
    for (const [code, raw] of Object.entries(this.records())) {
      const hay = `${raw.product_name ?? ''} ${raw.generic_name ?? ''} ${raw.brands ?? ''}`.toLowerCase();
      if (!hay.includes(q)) continue;
      const p = mapOffProduct(code, raw, this.opts);
      if (p) out.push(p);
      if (out.length >= limit) break;
    }
    return out;
  }
}
