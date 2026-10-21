// Home-screen widget (P3-C, D440-D443). Native rendering is a device check; everything the widget DECIDES is tested here:
// which rows, in which order, what a tap does (same command path as the app, offline queue included), sign-out clearing.
import React from 'react';
import { SupabaseDataSource } from '@/data/supabaseDataSource';
import { OfflineStore, type KeyValueStore } from '@/data/offlineQueue';
import { WidgetStateStore, WIDGET_STATE_KEY } from '@/widget/widgetState';
import { loadWidgetModel, tickFromWidget, undoFromWidget, type WidgetDeps } from '@/widget/widgetController';
import { UNDO_WINDOW_MS, WIDGET_MAX_ROWS, buildWidgetModel, quantityText } from '@/widget/widgetModel';
import { itemIdOf } from '@/widget/widgetTaskHandler';
import type { ShoppingListItem } from '@/viewModels';
import { FakeBackend, HH, uid } from './helpers/fakeSupabase';

// Stand-in primitives: the real ones are native bridges. They keep props so the tree can be inspected.
jest.mock('react-native-android-widget', () => {
  const make = (name: string) => {
    const C = (props: { children?: unknown }) => props.children ?? null;
    C.displayName = name;
    return C;
  };
  return { FlexWidget: make('FlexWidget'), TextWidget: make('TextWidget') };
});
// eslint-disable-next-line import/first
import { CLICK_TICK, CLICK_UNDO, shoppingWidgetTree } from '@/widget/ShoppingWidget';

function memoryKv(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => void data.set(k, v), removeItem: async (k) => void data.delete(k) };
}

const ids = { milk: uid(1), eggs: uid(2), flour: uid(3), salt: uid(4) };

function setup(over: { household?: string | null } = {}) {
  const backend = new FakeBackend();
  const kv = memoryKv();
  let n = 7000;
  const ds = new SupabaseDataSource({ client: backend.asClient(), store: new OfflineStore(kv), newId: () => uid(n++), now: () => new Date('2026-10-21T10:00:00Z') });
  const prefs = new WidgetStateStore(kv);
  let clock = Date.parse('2026-10-21T10:00:00Z');
  const deps: WidgetDeps = { source: () => ds, state: prefs, now: () => clock };
  const ready = (over.household === undefined ? HH : over.household) ? prefs.save({ householdId: HH, lastTick: null }) : Promise.resolve();
  return { backend, kv, ds, prefs, deps, ready, advance: (ms: number) => { clock += ms; } };
}

const item = (id: string, name: string, over: Partial<ShoppingListItem> = {}): ShoppingListItem => ({
  id, householdId: 'h', displayName: name, quantity: { kind: 'exact', value: 1, unit: 'item', originalText: '1' }, aisle: 'Other', ticked: false, ...over,
});

describe('buildWidgetModel (pure)', () => {
  it('shows open items only, caps the rows and counts the rest', () => {
    const items = Array.from({ length: 12 }, (_, i) => item(`i${i}`, `Item ${i}`, { ticked: i === 0 }));
    const m = buildWidgetModel('h', { items, now: 0 });
    expect(m.open).toBe(11);
    expect(m.rows).toHaveLength(WIDGET_MAX_ROWS);
    expect(m.more).toBe(11 - WIDGET_MAX_ROWS);
    expect(m.rows.map((r) => r.label)).not.toContain('Item 0');
  });

  it('follows the selected store aisle order, "not placed" last', () => {
    const items = [item('a', 'Apples', { category: 'Fruit' }), item('b', 'Bread', { category: 'Bakery' }), item('c', 'Cheese', { category: 'Dairy' })];
    const book = {
      stores: [{ id: 's1', name: 'Tesco', chain: null, notes: null }],
      aisles: [{ id: 'a1', storeId: 's1', label: 'Aisle 1', sortOrder: 1 }, { id: 'a2', storeId: 's1', label: 'Aisle 2', sortOrder: 2 }],
      placements: [
        { storeId: 's1', aisleId: 'a2', targetType: 'item' as const, targetKey: 'apples' },
        { storeId: 's1', aisleId: 'a1', targetType: 'item' as const, targetKey: 'cheese' },
      ],
    };
    const m = buildWidgetModel('h', { items, book, storeId: 's1', now: 0 });
    expect(m.rows.map((r) => r.label)).toEqual(['Cheese', 'Apples', 'Bread']);
    expect(m.storeName).toBe('Tesco');
    // An unknown / cleared store falls back to the plain order.
    expect(buildWidgetModel('h', { items, book, storeId: 'gone', now: 0 }).rows.map((r) => r.label)).toEqual(['Apples', 'Bread', 'Cheese']);
  });

  it('offers undo only inside the window and while the item is still ticked', () => {
    const items = [item('a', 'Apples', { ticked: true }), item('b', 'Bread')];
    const lastTick = { itemId: 'a', name: 'Apples', at: 1000 };
    expect(buildWidgetModel('h', { items, lastTick, now: 1000 + UNDO_WINDOW_MS }).undo).toEqual({ itemId: 'a', name: 'Apples' });
    expect(buildWidgetModel('h', { items, lastTick, now: 1001 + UNDO_WINDOW_MS }).undo).toBeUndefined();
    expect(buildWidgetModel('h', { items: [item('a', 'Apples')], lastTick, now: 1000 }).undo).toBeUndefined();
  });

  it('formats quantities compactly', () => {
    expect(quantityText({ kind: 'exact', value: 2, unit: 'l', originalText: '2 l' })).toBe('2 l');
    expect(quantityText({ kind: 'exact', value: 1, unit: 'item', originalText: '1' })).toBe('');
    expect(quantityText({ kind: 'exact', value: 6, unit: 'item', originalText: '6' })).toBe('6');
    expect(quantityText({ kind: 'to_taste', originalText: 'to taste' })).toBe('');
  });
});

describe('widget controller over the real data source', () => {
  it('is signed out until the app has told it a household, and after the session is gone', async () => {
    const s = setup({ household: null });
    expect((await loadWidgetModel(s.deps)).kind).toBe('signed_out');
    await s.ready;
    await s.prefs.save({ householdId: HH, lastTick: null });
    expect((await loadWidgetModel(s.deps)).kind).toBe('list');
    // Session ended elsewhere: the widget forgets the household and prompts to sign in.
    const gone = Object.assign(Object.create(s.ds), { getSession: async () => null }) as SupabaseDataSource;
    const m = await loadWidgetModel({ ...s.deps, source: () => gone });
    expect(m.kind).toBe('signed_out');
    expect(s.kv.data.has(WIDGET_STATE_KEY)).toBe(false);
  });

  it('lists the open items of the active list', async () => {
    const s = setup();
    await s.ready;
    const m = await loadWidgetModel(s.deps);
    if (m.kind !== 'list') throw new Error('expected a list');
    expect(m.rows.map((r) => r.label).sort()).toEqual(['Eggs', 'Flour', 'Milk', 'Salt']);
  });

  it('a tap ticks through the engine command path (idempotent id), removes the row and offers undo', async () => {
    const s = setup();
    await s.ready;
    const m = await tickFromWidget(s.deps, ids.milk);
    if (m.kind !== 'list') throw new Error('expected a list');
    expect(m.rows.map((r) => r.id)).not.toContain(ids.milk);
    expect(m.undo).toEqual({ itemId: ids.milk, name: 'Milk' });
    const rpcs = s.backend.rpcCalls.filter((c) => c.fn === 'record_purchase');
    expect(rpcs).toHaveLength(1);
    // Tapping the same row again (stale widget) is refused by the engine: nothing is double-counted.
    await tickFromWidget(s.deps, ids.milk);
    expect(s.backend.rpcCalls.filter((c) => c.fn === 'record_purchase')).toHaveLength(1);
  });

  it('offline: the tick is queued with its id, shown as waiting, and delivered once on the periodic refresh', async () => {
    const s = setup();
    await s.ready;
    await loadWidgetModel(s.deps); // cache the list while online
    s.backend.offline = true;
    const m = await tickFromWidget(s.deps, ids.eggs);
    if (m.kind !== 'list') throw new Error('expected a list');
    expect(m.rows.map((r) => r.id)).not.toContain(ids.eggs);
    expect(m.pending).toBe(1);
    expect(s.ds.pendingCount()).toBe(1);
    // Still offline on the periodic update: nothing lost, nothing duplicated.
    await loadWidgetModel(s.deps, { flush: true });
    expect(s.ds.pendingCount()).toBe(1);
    s.backend.offline = false;
    const after = await loadWidgetModel(s.deps, { flush: true });
    if (after.kind !== 'list') throw new Error('expected a list');
    expect(after.pending).toBe(0);
    expect(s.ds.pendingCount()).toBe(0);
    // Every attempt (offline retries included) carried the SAME event id: the server can only ever record one tick.
    expect(new Set(s.backend.rpcCalls.filter((c) => c.fn === 'record_purchase').map((c) => c.args.p_event_id)).size).toBe(1);
  });

  it('undo voids the tick and clears the offer', async () => {
    const s = setup();
    await s.ready;
    await tickFromWidget(s.deps, ids.flour);
    const m = await undoFromWidget(s.deps, ids.flour);
    if (m.kind !== 'list') throw new Error('expected a list');
    expect(m.rows.map((r) => r.id)).toContain(ids.flour);
    expect(m.undo).toBeUndefined();
  });

  it('the widget and the app share one queue when the app source is registered (no second writer)', async () => {
    const s = setup();
    await s.ready;
    await tickFromWidget(s.deps, ids.milk);
    // The very same data source instance sees the tick without any reload.
    const list = await s.ds.getShoppingList(HH);
    expect(list.items.find((i) => i.id === ids.milk)?.ticked).toBe(true);
  });
});

describe('widget tree', () => {
  type Node = { type?: { displayName?: string }; props: Record<string, unknown> };
  function walk(el: unknown, out: Node[] = []): Node[] {
    if (!el || typeof el !== 'object') return out;
    const n = el as Node & { props?: { children?: unknown } };
    if (Array.isArray(el)) { el.forEach((c) => walk(c, out)); return out; }
    if (n.props) {
      out.push(n as Node);
      const t = n.type as unknown as ((p: unknown) => unknown) | undefined;
      // Our own function components (Frame / Body) are expanded; the stand-in primitives just return their children.
      if (typeof t === 'function' && !(t as { displayName?: string }).displayName) walk(t(n.props), out);
      else walk(n.props.children, out);
    }
    return out;
  }
  const clicks = (tree: React.JSX.Element) => walk(tree).filter((n) => n.props.clickAction).map((n) => ({ a: n.props.clickAction, d: n.props.clickActionData }));

  it('wires header -> open app, row -> tick, footer -> undo', () => {
    const model = buildWidgetModel('h', { items: [item('a', 'Apples'), item('b', 'Bread'), item('c', 'Cake', { ticked: true })], lastTick: { itemId: 'c', name: 'Cake', at: 10 }, now: 20 });
    const { light, dark } = shoppingWidgetTree(model);
    for (const tree of [light, dark]) {
      const c = clicks(tree);
      expect(c[0]).toEqual({ a: 'OPEN_APP', d: undefined });
      expect(c.filter((x) => x.a === CLICK_TICK).map((x) => x.d)).toEqual([{ itemId: 'a' }, { itemId: 'b' }]);
      expect(c.filter((x) => x.a === CLICK_UNDO).map((x) => x.d)).toEqual([{ itemId: 'c' }]);
    }
  });

  it('signed out and error states only open the app', () => {
    for (const model of [{ kind: 'signed_out' as const }, { kind: 'error' as const, message: 'x' }]) {
      expect(clicks(shoppingWidgetTree(model).light).map((c) => c.a)).toEqual(['OPEN_APP']);
    }
  });
});

describe('click payload handling', () => {
  it('only a plain string item id is accepted', () => {
    expect(itemIdOf({ itemId: 'abc' })).toBe('abc');
    expect(itemIdOf({ itemId: 5 })).toBeNull();
    expect(itemIdOf({ itemId: '' })).toBeNull();
    expect(itemIdOf({ itemId: 'x'.repeat(65) })).toBeNull();
    expect(itemIdOf(undefined)).toBeNull();
  });
});
