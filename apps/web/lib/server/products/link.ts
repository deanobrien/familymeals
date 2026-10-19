import 'server-only';
import type { ProductSource } from '@fr/product-sources';
import { getIngredientCatalogue } from '../refdata/catalogue';
import { lookupProduct } from './lookup';
import { getProductSnapshotStore, type ProductSnapshotStore } from './store';

const MAX_LINKS = 20;

/**
 * After a pantry scan is confirmed: for every confirmed row that came from a barcode AND was matched to a canonical
 * ingredient, store the product snapshot linked to that ingredient (D187). The product is looked up again server-side
 * (cache hit in the normal case) and NEVER taken from the client, so a tampered request cannot plant nutrition numbers.
 * Free-text rows (no ingredient) are not linked: nothing to attach the nutrition to.
 */
export async function linkScannedProducts(
  householdId: string,
  rows: readonly { barcode?: string; ingredientId?: string }[],
  deps: { source?: ProductSource; store?: ProductSnapshotStore; now?: () => Date } = {},
): Promise<{ linked: number; skipped: number }> {
  const store = deps.store ?? getProductSnapshotStore();
  const catalogue = getIngredientCatalogue();
  const seen = new Set<string>();
  let linked = 0;
  let skipped = 0;
  for (const r of rows) {
    if (typeof r.barcode !== 'string' || typeof r.ingredientId !== 'string' || !catalogue.get(r.ingredientId)) continue;
    if (seen.has(r.barcode) || seen.size >= MAX_LINKS) continue;
    seen.add(r.barcode);
    const out = await lookupProduct(r.barcode, deps.source ? { source: deps.source } : {});
    if (!out.ok) { skipped++; continue; }
    await store.save(householdId, {
      barcode: out.lookup.product.barcode,
      ingredientId: r.ingredientId,
      product: out.lookup.product,
      linkedAt: (deps.now ?? (() => new Date()))().toISOString(),
    });
    linked++;
  }
  return { linked, skipped };
}
