import type { AllergenGroup, NutrientKey, NutrientValue, Quantity } from '@fr/domain';

/**
 * Packaged-product lookup contract (PRJ-018 X2, D180+). A `ProductSource` returns normalised `Product`s; nothing
 * downstream ever sees a provider's raw payload. Server-side only (the adapter calls a third-party API).
 */

export interface ProductSourceInfo {
  publisher: string;
  /** Page for this product on the publisher's site (the attribution link). */
  url: string;
  /** The code the product was looked up by (EAN/GTIN). */
  code: string;
  retrievedAt: string;
  /** e.g. 'ODbL 1.0 (database), DbCL 1.0 (contents)'. */
  licence: string;
}

export interface ProductImage {
  url: string;
  /** Shown beside the image wherever it appears. We hotlink for display only; the image is never copied or stored. */
  licenceNote: string;
}

/** What we could safely say about how this product maps onto our canonical ingredient catalogue. */
export type IngredientSuggestion =
  | { status: 'matched'; ingredientId: string; ingredientName: string; via: 'name' | 'category'; matchedOn: string }
  | { status: 'ambiguous'; candidates: { ingredientId: string; ingredientName: string }[]; matchedOn: string }
  | { status: 'none' };

export interface ProductAllergens {
  /** 'listed' = the source lists allergens for this product (possibly an empty list with an ingredients list). 'unknown' = no allergen data: NEVER read as "allergen free". */
  status: 'listed' | 'unknown';
  contains: AllergenGroup[];
  traces: AllergenGroup[];
  /** Source tags that do not map onto the UK-14 groups (kept so nothing is silently dropped). */
  unmapped: string[];
}

export interface ProductNutrition {
  /** The label basis. Liquids are per 100 ml, everything else per 100 g. */
  per: 'g' | 'ml';
  /** Per-100 values. 'unknown' = the label did not give it (never 0); 'zero' only when the source says 0. */
  per100: NutrientValue[];
  /** Keys computed rather than read (salt from sodium, or sodium from salt, kcal from kJ). */
  derived: NutrientKey[];
  /** Why the nutrition block was withheld, if it was (e.g. 'implausible: macros exceed 100 g'). */
  withheldReason?: string;
}

export interface Product {
  barcode: string;
  name: string;
  brand?: string;
  genericName?: string;
  /** Whole-pack size as a Quantity (g / ml); absent when unreadable. */
  packSize?: Quantity;
  /** The pack text as published ("2 x 400g"), for display. */
  packSizeText?: string;
  /** Number of units inside the pack ("6 x 125g" => 6), when stated. */
  packCount?: number;
  nutrition: ProductNutrition;
  allergens: ProductAllergens;
  /** Category tags, most general first, e.g. ['en:plant-based-foods', 'en:canned-tomatoes']. */
  categories: string[];
  suggestion: IngredientSuggestion;
  image?: ProductImage;
  source: ProductSourceInfo;
}

export type ProductErrorCode = 'invalid_barcode' | 'not_found' | 'rate_limited' | 'upstream' | 'timeout' | 'bad_response' | 'disabled';

export class ProductSourceError extends Error {
  constructor(
    readonly code: ProductErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'ProductSourceError';
  }
}

export interface SearchOptions {
  country?: string;
  limit?: number;
}

export interface ProductSource {
  readonly id: string;
  /** Resolves to null when the product is not in the source. Throws ProductSourceError for failures. */
  byBarcode(ean: string): Promise<Product | null>;
  /** Server-side text search. Never wire this to search-as-you-type (the source blocks it). */
  search(query: string, options?: SearchOptions | string): Promise<Product[]>;
}

/** Minimal matcher shape (the engine's IngredientMatcher satisfies it). */
export interface NameMatcher {
  match(name: string): {
    status: 'matched' | 'ambiguous' | 'no_match';
    ingredientId?: string;
    ingredient?: { id: string; name: string };
    candidates: string[];
  };
}
