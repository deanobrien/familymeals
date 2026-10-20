// Stores, aisles and placements on the phone (AS1, D298). Pure helpers over the engine's store-order module; the
// DataSource reads `household_store_book` (one RPC) and caches it in AsyncStorage so the aisle order works offline.
import type { PlacementTargetType, StoreBook } from '@fr/engine/shopping';
import { normaliseItemKey } from '@fr/engine/shopping';
import type { ShoppingListItem } from '@/viewModels';

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** A `household_store_book` payload -> StoreBook, dropping malformed rows. */
export function parseStoreBook(json: unknown): StoreBook {
  const o = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const rows = (k: string): Array<Record<string, unknown>> => (Array.isArray(o[k]) ? (o[k] as Array<Record<string, unknown>>) : []);
  return {
    stores: rows('stores').filter((s) => s.id && s.name).map((s) => ({
      id: str(s.id), name: str(s.name), chain: typeof s.chain === 'string' ? s.chain : null, notes: typeof s.notes === 'string' ? s.notes : null,
    })),
    aisles: rows('aisles').filter((a) => a.id && a.storeId).map((a) => ({
      id: str(a.id), storeId: str(a.storeId), label: str(a.label), sortOrder: Number(a.sortOrder) || 0,
    })),
    placements: rows('placements')
      .filter((p) => p.storeId && p.aisleId && ['ingredient', 'item', 'category'].includes(str(p.targetType)))
      .map((p) => ({ storeId: str(p.storeId), aisleId: str(p.aisleId), targetType: str(p.targetType) as PlacementTargetType, targetKey: str(p.targetKey) })),
  };
}

export const isStoreBook = (b: unknown): b is StoreBook =>
  !!b && typeof b === 'object' && Array.isArray((b as StoreBook).stores) && Array.isArray((b as StoreBook).aisles) && Array.isArray((b as StoreBook).placements);

/** What the ordering needs from a list item. */
export const orderable = (i: ShoppingListItem) => ({
  id: i.id,
  displayName: i.displayName,
  ingredientId: i.ingredientId,
  category: i.category ?? i.aisle,
});

/** The placement key for an item: the ingredient when it has one, else its normalised name. */
export function placementTarget(i: ShoppingListItem): { targetType: PlacementTargetType; targetKey: string } {
  return i.ingredientId ? { targetType: 'ingredient', targetKey: i.ingredientId } : { targetType: 'item', targetKey: normaliseItemKey(i.displayName) };
}
