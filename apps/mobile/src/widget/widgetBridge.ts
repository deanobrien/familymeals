// Glue between the app and the widget (P3-C, D441). Everything here is safe to call anywhere: off Android, in tests, or when the
// native module is missing it does nothing, and a widget failure must never break the app.
import { Platform } from 'react-native';
import type { DataSource } from '@/data/DataSource';
import { SupabaseDataSource } from '@/data/supabaseDataSource';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import { WidgetStateStore } from './widgetState';
import { loadWidgetModel, tickFromWidget, undoFromWidget, type WidgetDeps } from './widgetController';
import type { WidgetModel } from './widgetModel';
import { WIDGET_NAME, shoppingWidgetTree } from './ShoppingWidget';

const state = new WidgetStateStore();

/** The app's own data source while the app process is alive: the widget then shares its queue instead of racing it (D441). */
let active: DataSource | null = null;
let standalone: DataSource | null = null;

export function registerActiveSource(ds: DataSource | null): void {
  active = ds;
}

function source(): DataSource | null {
  if (active) return active;
  if (!isSupabaseConfigured()) return null; // the mock data source is per-process memory: nothing meaningful to show
  standalone ??= new SupabaseDataSource({ client: getSupabase() });
  return standalone;
}

export const widgetDeps: WidgetDeps = { source, state };

const supported = () => Platform.OS === 'android';

async function draw(model: WidgetModel): Promise<void> {
  const { requestWidgetUpdate } = await import('react-native-android-widget');
  await requestWidgetUpdate({ widgetName: WIDGET_NAME, renderWidget: () => shoppingWidgetTree(model) });
}

/** Re-read the list and redraw every placed widget (after app sync, tick, household switch). */
export async function refreshShoppingWidget(opts: { flush?: boolean } = {}): Promise<void> {
  if (!supported()) return;
  try {
    await draw(await loadWidgetModel(widgetDeps, opts));
  } catch {
    /* widget is best effort */
  }
}

/** The app shows this household: remember it for the widget and redraw. */
export async function setWidgetHousehold(householdId: string | null): Promise<void> {
  if (!supported() || !householdId) return;
  const cur = await state.load();
  if (cur.householdId !== householdId) await state.save({ householdId, lastTick: null });
  await refreshShoppingWidget();
}

/** Sign-out / account deletion: forget the household and show the signed-out prompt. Nothing of the list stays on the home screen. */
export async function clearShoppingWidget(): Promise<void> {
  if (!supported()) return;
  try {
    await state.clear();
    await draw({ kind: 'signed_out' });
  } catch {
    /* widget is best effort */
  }
}

/** Used by the task handler. */
export const widgetActions = {
  load: (flush = false) => loadWidgetModel(widgetDeps, { flush }),
  tick: (itemId: string) => tickFromWidget(widgetDeps, itemId),
  undo: (itemId: string) => undoFromWidget(widgetDeps, itemId),
};
