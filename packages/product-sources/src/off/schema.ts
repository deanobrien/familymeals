import { z } from 'zod';

/**
 * Open Food Facts v2 response, validated at the boundary. Deliberately loose about field presence (crowd-sourced
 * data: any field can be missing, a number can arrive as a string) and strict about shape, so a changed payload is
 * a `bad_response`, not a silent wrong value.
 */
const looseNumber = z.union([z.number(), z.string()]);

export const OffProduct = z.looseObject({
  code: z.string().optional(),
  product_name: z.string().optional(),
  product_name_en: z.string().optional(),
  generic_name: z.string().optional(),
  brands: z.string().optional(),
  quantity: z.string().optional(),
  product_quantity: looseNumber.optional(),
  product_quantity_unit: z.string().optional(),
  nutriments: z.record(z.string(), z.unknown()).optional(),
  allergens_tags: z.array(z.string()).optional(),
  traces_tags: z.array(z.string()).optional(),
  ingredients_text: z.string().optional(),
  categories_tags: z.array(z.string()).optional(),
  image_front_url: z.string().optional(),
  image_front_small_url: z.string().optional(),
  image_url: z.string().optional(),
});
export type OffProduct = z.infer<typeof OffProduct>;

/** GET /api/v2/product/{code}. `status` 1 = found, 0 = not found. */
export const OffProductResponse = z.looseObject({
  code: z.string().optional(),
  status: z.union([z.number(), z.string()]).optional(),
  status_verbose: z.string().optional(),
  product: OffProduct.optional(),
});
export type OffProductResponse = z.infer<typeof OffProductResponse>;

/** GET /cgi/search.pl?json=1 */
export const OffSearchResponse = z.looseObject({
  products: z.array(OffProduct).default([]),
  count: looseNumber.optional(),
});
export type OffSearchResponse = z.infer<typeof OffSearchResponse>;
