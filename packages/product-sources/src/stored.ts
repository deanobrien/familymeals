import { AllergenGroup, NutrientKey, NutrientValue, Quantity } from '@fr/domain';
import { z } from 'zod';
import type { Product } from './types';

/**
 * Validates a product snapshot read back from storage (a jsonb column). Snapshots are our own normalised `Product`,
 * never a provider payload, but they are re-validated on read: a corrupt or hand-edited row is dropped, not trusted.
 */
const Suggestion = z.discriminatedUnion('status', [
  z.object({ status: z.literal('matched'), ingredientId: z.string(), ingredientName: z.string(), via: z.enum(['name', 'category']), matchedOn: z.string() }),
  z.object({ status: z.literal('ambiguous'), candidates: z.array(z.object({ ingredientId: z.string(), ingredientName: z.string() })), matchedOn: z.string() }),
  z.object({ status: z.literal('none') }),
]);

export const StoredProduct = z.object({
  barcode: z.string().regex(/^\d{8}$|^\d{12,14}$/),
  name: z.string().min(1).max(300),
  brand: z.string().max(200).optional(),
  genericName: z.string().max(300).optional(),
  packSize: Quantity.optional(),
  packSizeText: z.string().max(100).optional(),
  packCount: z.number().int().positive().optional(),
  nutrition: z.object({
    per: z.enum(['g', 'ml']),
    per100: z.array(NutrientValue).max(20),
    derived: z.array(NutrientKey),
    withheldReason: z.string().optional(),
  }),
  allergens: z.object({
    status: z.enum(['listed', 'unknown']),
    contains: z.array(AllergenGroup),
    traces: z.array(AllergenGroup),
    unmapped: z.array(z.string()),
  }),
  categories: z.array(z.string()).max(100),
  suggestion: Suggestion,
  image: z.object({ url: z.string().url(), licenceNote: z.string() }).optional(),
  source: z.object({ publisher: z.string(), url: z.string(), code: z.string(), retrievedAt: z.string(), licence: z.string() }),
});

export function parseStoredProduct(value: unknown): Product | null {
  const r = StoredProduct.safeParse(value);
  return r.success ? (r.data as Product) : null;
}
