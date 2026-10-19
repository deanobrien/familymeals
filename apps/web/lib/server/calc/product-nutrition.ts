import 'server-only';
import type { NutrientProfile, ProfileNutrient } from '@fr/engine/nutrition';
import type { Product } from '@fr/product-sources';
import { PRODUCT_NUTRITION_LABEL, type ProductSourceUsed } from '../../products/types';
import type { ProductSnapshot } from '../products/store';

/**
 * Product-label nutrition for calculations (D186). A household product snapshot LINKED to a canonical ingredient
 * replaces that ingredient's CoFID profile for the household's recipes, labelled "from product label via Open Food
 * Facts" with the product and barcode as provenance. Conservative:
 *  - only a per-100 g label (liquids are per 100 ml and would need a density: CoFID is kept);
 *  - only when energy is known (a half-empty label must not displace a complete CoFID profile);
 *  - the whole profile is the product's: no mixing nutrients from two sources (a nutrient the label omitted stays
 *    unknown, never 0 and never silently filled from CoFID).
 */
export function profileFromProduct(product: Product): NutrientProfile | undefined {
  const n = product.nutrition;
  if (n.per !== 'g' || n.withheldReason || n.per100.length === 0) return undefined;
  if (n.per100.find((v) => v.nutrient === 'energy_kcal')?.status !== 'known') return undefined;
  const source = `${PRODUCT_NUTRITION_LABEL}: ${product.name} (${product.barcode})`;
  const per100g: NutrientProfile['per100g'] = {};
  for (const v of n.per100) {
    const entry: ProfileNutrient = { status: v.status, estimate: v.estimate, source };
    if (v.value !== undefined) entry.value = v.value;
    if (n.derived.includes(v.nutrient)) entry.derived = true;
    per100g[v.nutrient] = entry;
  }
  return { per100g, source };
}

export interface ProductNutritionHit {
  profile: NutrientProfile;
  used: ProductSourceUsed;
}

export interface ProductNutritionSource {
  /** Changes whenever the household's snapshots change (part of the calculator cache key). */
  version(): string;
  forIngredient(ingredientId: string): ProductNutritionHit | undefined;
}

/** The newest linked, usable snapshot per ingredient. */
export function nutritionSourceFrom(
  snapshots: () => readonly ProductSnapshot[],
  version: () => string,
  ingredientName: (id: string) => string | undefined,
): ProductNutritionSource {
  return {
    version,
    forIngredient(ingredientId) {
      const candidates = snapshots()
        .filter((s) => s.ingredientId === ingredientId)
        .sort((a, b) => (a.linkedAt < b.linkedAt ? 1 : a.linkedAt > b.linkedAt ? -1 : 0));
      for (const s of candidates) {
        const profile = profileFromProduct(s.product);
        if (profile) {
          return {
            profile,
            used: {
              ingredientId, ingredientName: ingredientName(ingredientId) ?? s.product.name, productName: s.product.name,
              barcode: s.barcode, url: s.product.source.url, retrievedAt: s.product.source.retrievedAt,
            },
          };
        }
      }
      return undefined;
    },
  };
}
