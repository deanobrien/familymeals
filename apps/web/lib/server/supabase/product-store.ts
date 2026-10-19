// Supabase product snapshot store (PRJ-018 X2, D187). Mirrors the price store: the household's snapshots are loaded into
// a per-household cache by `refresh()` (called before costing / nutrition) and served synchronously from it.
// Writes go through `save_product_snapshot` / `delete_product_snapshot` (SECURITY DEFINER, member + active-household
// checked); the table itself is not directly readable or writable by `authenticated`.
import 'server-only';
import { parseStoredProduct } from '@fr/product-sources';
import type { ProductSnapshot, ProductSnapshotStore } from '../products/store';
import { nutritionSourceFrom, type ProductNutritionSource } from '../calc/product-nutrition';
import { getIngredientCatalogue } from '../refdata/catalogue';
import type { DataContext } from './backend';
import { callRpc } from './rpc';

type Row = Record<string, unknown>;

/** A DB row -> snapshot, or null when the stored product no longer satisfies the schema (dropped, not trusted). */
export function snapshotFromRow(row: Row): ProductSnapshot | null {
  const product = parseStoredProduct(row.snapshot);
  if (!product) return null;
  return {
    barcode: String(row.barcode),
    ingredientId: typeof row.ingredient_id === 'string' ? row.ingredient_id : null,
    product,
    linkedAt: String(row.linked_at ?? product.source.retrievedAt),
  };
}

interface Entry { snaps: ProductSnapshot[]; key: string; version: number; loadedAt: number }

export class SupabaseProductSnapshotStore implements ProductSnapshotStore {
  private readonly cache = new Map<string, Entry>();
  private readonly versions = new Map<string, number>();
  private epoch = 0;

  constructor(
    private readonly resolve: () => Promise<DataContext>,
    private readonly ttlMs = 15_000,
    private readonly clock: () => number = Date.now,
  ) {}

  private async ctxFor(householdId: string): Promise<DataContext> {
    const ctx = await this.resolve();
    if (ctx.householdId !== householdId) throw new Error('product store: household does not match the session');
    return ctx;
  }

  async refresh(householdId: string, force = false): Promise<void> {
    const cur = this.cache.get(householdId);
    if (!force && cur && this.clock() - cur.loadedAt < this.ttlMs) return;
    const ctx = await this.ctxFor(householdId);
    const rows = (await callRpc<Row[]>(ctx.client, 'household_product_snapshots', { p_household_id: householdId })) ?? [];
    const snaps = rows.map(snapshotFromRow).filter((s): s is ProductSnapshot => s !== null);
    const key = JSON.stringify(snaps);
    if (cur && cur.key === key) {
      cur.loadedAt = this.clock();
      return;
    }
    const version = (this.versions.get(householdId) ?? 0) + 1;
    this.versions.set(householdId, version);
    this.cache.set(householdId, { snaps, key, version, loadedAt: this.clock() });
  }

  list(householdId: string): ProductSnapshot[] {
    return structuredClone(this.cache.get(householdId)?.snaps ?? []);
  }

  async save(householdId: string, snapshot: ProductSnapshot): Promise<void> {
    const ctx = await this.ctxFor(householdId);
    await callRpc(ctx.client, 'save_product_snapshot', {
      p_household_id: householdId,
      p_barcode: snapshot.barcode,
      p_ingredient_id: snapshot.ingredientId,
      p_snapshot: snapshot.product,
      p_retrieved_at: snapshot.product.source.retrievedAt,
    });
    await this.refresh(householdId, true);
  }

  async remove(householdId: string, barcode: string): Promise<void> {
    const ctx = await this.ctxFor(householdId);
    await callRpc(ctx.client, 'delete_product_snapshot', { p_household_id: householdId, p_barcode: barcode });
    await this.refresh(householdId, true);
  }

  reset(): void {
    this.cache.clear();
    this.versions.clear();
    this.epoch++;
  }

  asNutritionSource(householdId: string): ProductNutritionSource {
    return nutritionSourceFrom(
      () => this.cache.get(householdId)?.snaps ?? [],
      () => `db-products:${this.epoch}:${this.cache.get(householdId)?.version ?? 0}`,
      (id) => getIngredientCatalogue().get(id)?.name,
    );
  }
}
