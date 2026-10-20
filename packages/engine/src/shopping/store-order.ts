// PRJ-018 AS1 (D290-D291): order a shopping list for a particular store (walk the shop aisle by aisle).
// Pure and deterministic; no I/O. The caller (web page, mobile screen) passes the already filtered list (ticked items
// hidden or shown per the existing behaviour) and gets sections back in aisle order.
//
// A placement maps something on the list to one aisle of one store:
//   ingredient  key = canonical ingredient id        (most specific, wins)
//   item        key = normalised display name        (free-text items that have no ingredient link)
//   category    key = the list category label        (fallback for everything in that category)
// Precedence: ingredient > item > category. Anything with no placement lands in "Not placed yet" at the end.

export const NOT_PLACED_LABEL = 'Not placed yet';

export type PlacementTargetType = 'ingredient' | 'item' | 'category';

export interface Store {
  id: string;
  name: string;
  chain?: string | null;
  notes?: string | null;
}
export interface StoreAisle {
  id: string;
  storeId: string;
  label: string;
  sortOrder: number;
}
export interface StorePlacement {
  storeId: string;
  targetType: PlacementTargetType;
  targetKey: string;
  aisleId: string;
}
/** Everything one household knows about its stores (what the page loads once and caches for offline use). */
export interface StoreBook {
  stores: Store[];
  aisles: StoreAisle[];
  placements: StorePlacement[];
}
export const emptyStoreBook = (): StoreBook => ({ stores: [], aisles: [], placements: [] });

/** The part of a list item the ordering needs (a `ShoppingItem` satisfies it). */
export interface OrderableItem {
  id: string;
  displayName: string;
  ingredientId?: string | undefined;
  category: string;
}

export interface StoreSection<T> {
  /** null for the "Not placed yet" section. */
  aisleId: string | null;
  label: string;
  placed: boolean;
  items: T[];
}

export interface OrderForStoreOptions {
  /** Order of list categories inside "Not placed yet" (unknown categories after, alphabetically). */
  categoryOrder?: readonly string[];
  /** Keep aisles that have no items on the list (used by editors, never by the in-store view). */
  includeEmptyAisles?: boolean;
}

/** Lower-case, trim, strip punctuation, collapse spaces: the key for free-text (non-ingredient) placements. */
export function normaliseItemKey(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** The placement key candidates for an item, most specific first. */
export function placementKeys(item: OrderableItem): Array<{ type: PlacementTargetType; key: string }> {
  const out: Array<{ type: PlacementTargetType; key: string }> = [];
  if (item.ingredientId) out.push({ type: 'ingredient', key: item.ingredientId });
  const n = normaliseItemKey(item.displayName);
  if (n) out.push({ type: 'item', key: n });
  if (item.category) out.push({ type: 'category', key: item.category });
  return out;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Sorted copy of a store's aisles (sortOrder, then label, then id: stable and locale independent). */
export function sortedAisles(storeId: string, aisles: readonly StoreAisle[]): StoreAisle[] {
  return aisles
    .filter((a) => a.storeId === storeId)
    .sort((a, b) => a.sortOrder - b.sortOrder || cmp(a.label.toLowerCase(), b.label.toLowerCase()) || cmp(a.id, b.id));
}

/** Resolve the aisle for one item at one store, or null when nothing matches (ingredient > item > category). */
export function resolveAisle(
  item: OrderableItem,
  storeId: string,
  aisles: readonly StoreAisle[],
  placements: readonly StorePlacement[],
): StoreAisle | null {
  const ids = new Map(aisles.filter((a) => a.storeId === storeId).map((a) => [a.id, a]));
  const byTarget = new Map<string, string>();
  for (const p of placements) if (p.storeId === storeId) byTarget.set(`${p.targetType}\u0000${p.targetKey}`, p.aisleId);
  for (const { type, key } of placementKeys(item)) {
    const aisleId = byTarget.get(`${type}\u0000${key}`);
    const aisle = aisleId ? ids.get(aisleId) : undefined; // a placement pointing at a deleted aisle counts as "not placed"
    if (aisle) return aisle;
  }
  return null;
}

/**
 * Sections in aisle order for `store`. Items inside an aisle are sorted by name then id (so the order never jumps when
 * someone ticks something). Unplaced items go in a final "Not placed yet" section, grouped by list category order.
 */
export function orderForStore<T extends { item: OrderableItem }>(
  items: readonly T[],
  store: Pick<Store, 'id'>,
  aisles: readonly StoreAisle[],
  placements: readonly StorePlacement[],
  opts: OrderForStoreOptions = {},
): Array<StoreSection<T>> {
  const sorted = sortedAisles(store.id, aisles);
  const buckets = new Map<string, T[]>(sorted.map((a) => [a.id, []]));
  const unplaced: T[] = [];
  for (const v of items) {
    const a = resolveAisle(v.item, store.id, sorted, placements);
    if (a) buckets.get(a.id)!.push(v);
    else unplaced.push(v);
  }
  const byName = (x: T, y: T) =>
    cmp(x.item.displayName.toLowerCase(), y.item.displayName.toLowerCase()) || cmp(x.item.id, y.item.id);

  const sections: Array<StoreSection<T>> = [];
  for (const a of sorted) {
    const list = buckets.get(a.id)!;
    if (list.length === 0 && !opts.includeEmptyAisles) continue;
    sections.push({ aisleId: a.id, label: a.label, placed: true, items: list.sort(byName) });
  }
  const order = opts.categoryOrder ?? [];
  const rank = (c: string): number => {
    const i = order.indexOf(c);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  unplaced.sort((x, y) => rank(x.item.category) - rank(y.item.category) || cmp(x.item.category, y.item.category) || byName(x, y));
  if (unplaced.length > 0) sections.push({ aisleId: null, label: NOT_PLACED_LABEL, placed: false, items: unplaced });
  return sections;
}

// ---------------------------------------------------------------------------
// "Learn from my route": suggest an aisle order from the sequence the shopper ticked things in.
// Suggest only: the caller shows it and the user confirms before anything is reordered.
// ---------------------------------------------------------------------------

export interface RouteTick {
  aisleId: string;
}
export interface RouteSuggestion {
  /** Aisle ids of the store in the suggested order (all of them). */
  order: string[];
  /** True when `order` differs from the current order. */
  changed: boolean;
  /** Aisles in the order they were first visited (what the suggestion is based on). */
  visited: string[];
}

/**
 * The visited aisles take the slots the visited aisles already occupy, re-sorted by first visit; unvisited aisles keep their
 * place. Needs ticks in at least `minAisles` (default 3) different aisles, otherwise there is not enough evidence and the
 * suggestion is "unchanged". A tick in an aisle that is not in `current` is ignored.
 */
export function suggestRouteOrder(current: readonly string[], ticks: readonly RouteTick[], minAisles = 3): RouteSuggestion {
  const known = new Set(current);
  const visited: string[] = [];
  for (const t of ticks) if (known.has(t.aisleId) && !visited.includes(t.aisleId)) visited.push(t.aisleId);
  if (visited.length < minAisles) return { order: [...current], changed: false, visited };
  const slots = current.map((id, i) => (visited.includes(id) ? i : -1)).filter((i) => i >= 0);
  const order = [...current];
  slots.forEach((slot, n) => { order[slot] = visited[n]!; });
  return { order, changed: order.some((id, i) => id !== current[i]), visited };
}
