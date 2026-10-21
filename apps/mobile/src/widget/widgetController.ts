// Widget logic with no native pieces: load the model, tick, undo. A tick goes through `DataSource.tickItem`, i.e. the SAME command
// path as the app (engine command with a client-generated id, idempotent replay, persisted offline queue), never a second code path.
import type { StoreBook } from '@fr/engine/shopping';
import type { DataSource } from '@/data/DataSource';
import type { WidgetStateStore } from './widgetState';
import { buildWidgetModel, type WidgetModel } from './widgetModel';

export interface WidgetDeps {
  /** The data source to use: the app's own while the app process is alive, else a standalone one. Null = nothing configured. */
  source: () => DataSource | null;
  state: WidgetStateStore;
  now?: () => number;
}

const nowOf = (d: WidgetDeps) => (d.now ? d.now() : Date.now());

export async function loadWidgetModel(deps: WidgetDeps, opts: { flush?: boolean } = {}): Promise<WidgetModel> {
  const prefs = await deps.state.load();
  const ds = deps.source();
  if (!prefs.householdId || !ds) return { kind: 'signed_out' };
  let signedIn = false;
  try {
    signedIn = (await ds.getSession()) !== null;
  } catch {
    signedIn = false;
  }
  if (!signedIn) {
    await deps.state.clear(); // signed out elsewhere (or the session expired): do not keep showing the list
    return { kind: 'signed_out' };
  }
  // Periodic refresh: first deliver ticks that were made offline, then read. Both are safe to repeat (idempotent).
  if (opts.flush) await ds.flushPending().catch(() => 0);
  try {
    const state = await ds.getShoppingList(prefs.householdId);
    let book: StoreBook | undefined;
    let storeId: string | null = null;
    try {
      book = await ds.getStoreBook?.(prefs.householdId);
      storeId = (await ds.getSelectedStoreId?.(prefs.householdId)) ?? null;
    } catch {
      /* stores are optional: category order */
    }
    return buildWidgetModel(prefs.householdId, { items: state.items, book, storeId, pendingItemIds: state.pendingItemIds, lastTick: prefs.lastTick, now: nowOf(deps) });
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : 'Could not load the list' };
  }
}

/** Tap on an item. Returns the refreshed model. A refused tick (already complete, item gone) just refreshes. */
export async function tickFromWidget(deps: WidgetDeps, itemId: string): Promise<WidgetModel> {
  const prefs = await deps.state.load();
  const ds = deps.source();
  if (prefs.householdId && ds) {
    try {
      const before = await ds.getShoppingList(prefs.householdId);
      const name = before.items.find((i) => i.id === itemId)?.displayName ?? 'item';
      await ds.tickItem(prefs.householdId, itemId);
      await deps.state.save({ ...prefs, lastTick: { itemId, name, at: nowOf(deps) } });
    } catch {
      /* refused or not loadable: the refresh below tells the truth */
    }
  }
  return loadWidgetModel(deps);
}

export async function undoFromWidget(deps: WidgetDeps, itemId: string): Promise<WidgetModel> {
  const prefs = await deps.state.load();
  const ds = deps.source();
  if (prefs.householdId && ds) {
    try {
      await ds.undoTick(prefs.householdId, itemId);
    } catch {
      /* nothing to undo */
    }
    await deps.state.save({ ...prefs, lastTick: null });
  }
  return loadWidgetModel(deps);
}
