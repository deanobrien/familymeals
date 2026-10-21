// Home-screen widget (P3-C, D440-D443): the pure part. Turns the shopping list the data source already produced into the few rows
// a widget can show. No React, no native module: unit-tested in jest; the native rendering is a device check.
import { orderForStore, type StoreBook } from '@fr/engine/shopping';
import type { Quantity } from '@fr/domain';
import type { ShoppingListItem } from '@/viewModels';
import { orderable } from '@/lib/storeBook';

/** A widget cell is small: this many open items, then "+N more". */
export const WIDGET_MAX_ROWS = 8;
/** "Ticked X. Undo" stays on the widget this long (a misplaced tap on a small target is easy). */
export const UNDO_WINDOW_MS = 2 * 60 * 1000;

export interface WidgetRow {
  id: string;
  label: string;
  /** Quantity text ("2 pack", "500 g"), empty when none. */
  detail: string;
}

export interface LastTick {
  itemId: string;
  name: string;
  at: number;
}

export type ListModel = {
  kind: 'list';
  householdId: string;
  rows: WidgetRow[];
  /** Open items not shown. */
  more: number;
  /** All open items. */
  open: number;
  /** Ticks made on this phone that the server has not confirmed yet (offline). */
  pending: number;
  storeName?: string;
  /** Present while the undo window is open and the item is still ticked. */
  undo?: { itemId: string; name: string };
};

export type WidgetModel = { kind: 'signed_out' } | { kind: 'error'; message: string } | ListModel;

export function quantityText(q: Quantity): string {
  if (q.kind === 'exact' && q.value !== undefined) {
    const unit = q.unit === 'item' ? '' : q.unit === 'floz' ? 'fl oz' : q.unit;
    const v = Math.round(q.value * 100) / 100;
    return unit ? `${v} ${unit}` : v === 1 ? '' : `${v}`;
  }
  if (q.kind === 'approximate') return q.approxLabel ?? '';
  return '';
}

export interface BuildInput {
  items: readonly ShoppingListItem[];
  book?: StoreBook | undefined;
  storeId?: string | null | undefined;
  pendingItemIds?: readonly string[] | undefined;
  lastTick?: LastTick | null | undefined;
  now: number;
  max?: number;
}

/**
 * The open items in the order the shopping screen shows them: the selected store's aisle order when there is one, otherwise the
 * data source's own category order. Ticked items are never shown. Pure.
 */
export function buildWidgetModel(householdId: string, input: BuildInput): ListModel {
  const max = input.max ?? WIDGET_MAX_ROWS;
  const open = input.items.filter((i) => !i.ticked);
  const store = input.book && input.storeId ? input.book.stores.find((s) => s.id === input.storeId) : undefined;
  const ordered: ShoppingListItem[] = store && input.book
    ? orderForStore(open.map((i) => ({ item: orderable(i), li: i })), store, input.book.aisles, input.book.placements).flatMap((sec) => sec.items.map((x) => x.li))
    : open;
  const rows = ordered.slice(0, max).map((i): WidgetRow => ({ id: i.id, label: i.displayName, detail: quantityText(i.quantity) }));
  const t = input.lastTick;
  const undoable = t && input.now - t.at <= UNDO_WINDOW_MS && input.items.find((i) => i.id === t.itemId)?.ticked ? { itemId: t.itemId, name: t.name } : undefined;
  return {
    kind: 'list',
    householdId,
    rows,
    more: Math.max(0, ordered.length - rows.length),
    open: ordered.length,
    pending: input.pendingItemIds?.length ?? 0,
    ...(store ? { storeName: store.name } : {}),
    ...(undoable ? { undo: undoable } : {}),
  };
}
