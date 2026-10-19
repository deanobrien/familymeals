import 'server-only';
import type { Product } from '@fr/product-sources';
import { getDataContext, useSupabaseBackend } from '../supabase/backend';
import { SupabaseProductSnapshotStore } from '../supabase/product-store';
import { getIngredientCatalogue } from '../refdata/catalogue';
import { nutritionSourceFrom, type ProductNutritionSource } from '../calc/product-nutrition';

/**
 * Per-household product snapshots (D187): the normalised `Product` as it was when the household confirmed it, linked to
 * the canonical ingredient they chose. Snapshots are OUR normalised shape (never a provider payload) and are kept so
 * nutrition and provenance stay stable and offline even if the source record later changes or disappears. Product
 * images are NOT stored (only the hotlinked URL for display).
 */
export interface ProductSnapshot {
  barcode: string;
  /** The canonical ingredient the household linked this product to; null = remembered but not linked. */
  ingredientId: string | null;
  product: Product;
  linkedAt: string;
}

export interface ProductSnapshotStore {
  /** Synchronous read of the household's snapshots (async backends: call `refresh` first). */
  list(householdId: string): ProductSnapshot[];
  save(householdId: string, snapshot: ProductSnapshot): void | Promise<void>;
  remove(householdId: string, barcode: string): void | Promise<void>;
  refresh?(householdId: string): Promise<void>;
  reset(): void;
  /** The household's linked products as a nutrition source for its recipe calculator. */
  asNutritionSource(householdId: string): ProductNutritionSource;
}

export class InMemoryProductSnapshotStore implements ProductSnapshotStore {
  private readonly byHousehold = new Map<string, Map<string, ProductSnapshot>>();
  private readonly versions = new Map<string, number>();
  private epoch = 0;

  list(householdId: string): ProductSnapshot[] {
    return [...(this.byHousehold.get(householdId)?.values() ?? [])].map((s) => structuredClone(s));
  }

  save(householdId: string, snapshot: ProductSnapshot): void {
    const m = this.byHousehold.get(householdId) ?? new Map<string, ProductSnapshot>();
    m.set(snapshot.barcode, structuredClone(snapshot));
    this.byHousehold.set(householdId, m);
    this.bump(householdId);
  }

  remove(householdId: string, barcode: string): void {
    if (this.byHousehold.get(householdId)?.delete(barcode)) this.bump(householdId);
  }

  reset(): void {
    this.byHousehold.clear();
    this.versions.clear();
    this.epoch++;
  }

  private bump(householdId: string) {
    this.versions.set(householdId, (this.versions.get(householdId) ?? 0) + 1);
  }

  asNutritionSource(householdId: string): ProductNutritionSource {
    return nutritionSourceFrom(
      () => [...(this.byHousehold.get(householdId)?.values() ?? [])],
      () => `products:${this.epoch}:${this.versions.get(householdId) ?? 0}`,
      (id) => getIngredientCatalogue().get(id)?.name,
    );
  }
}

const KEY = Symbol.for('fr.products.snapshots');
type G = typeof globalThis & { [KEY]?: ProductSnapshotStore };

/** Process-wide singleton. Backend fixed per process (same rule as the price store). */
export function getProductSnapshotStore(): ProductSnapshotStore {
  const g = globalThis as G;
  return (g[KEY] ??= useSupabaseBackend() ? new SupabaseProductSnapshotStore(() => getDataContext()) : new InMemoryProductSnapshotStore());
}
