// Client-safe shapes for packaged-product lookup (PRJ-018 X2, D180+). Type-only imports from @fr/product-sources.
import type { Product } from '@fr/product-sources';
import type { ScanMatch } from '../pantry/scan-types';

export type { Product };

/** Shown wherever product data appears (Open Food Facts terms: ODbL attribution). */
export const PRODUCT_ATTRIBUTION = 'Product data © Open Food Facts contributors, ODbL';
export const PRODUCT_ATTRIBUTION_URL = 'https://world.openfoodfacts.org/';
export const SOURCES_PAGE = '/about/sources';
/** Label on nutrition figures that came from a product label rather than CoFID. */
export const PRODUCT_NUTRITION_LABEL = 'from product label via Open Food Facts';

/** GET /api/products/[barcode] success body. `match` is the conservative ingredient suggestion over our catalogue. */
export interface ProductLookupDto {
  product: Product;
  match: ScanMatch;
  provider: { id: string; isMock: boolean };
}

export interface ProductLookupError {
  code: string;
  message: string;
  retryable: boolean;
}

/** Where a nutrition figure came from when a product label replaced CoFID for an ingredient (provenance on results). */
export interface ProductSourceUsed {
  ingredientId: string;
  ingredientName: string;
  productName: string;
  barcode: string;
  url: string;
  retrievedAt: string;
}
