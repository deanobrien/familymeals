// Offline web shopping list (P3-C, D446): IndexedDB queue + snapshot, and the SAME replay semantics as the Android queue
// (idempotent command ids, replay in order on reconnect, conflict notices). Uses a fake IndexedDB; no browser.
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import type { Command } from '../shopping/engine';
import { activeView, defaultEngineContext } from '../shopping/engine';
import { ShoppingController, type Notice, type Transport } from '../shopping/controller';
import { InMemoryShoppingRepository } from '../server/shopping/repository';
import { syncList } from '../server/shopping/service';
import { deleteOfflineDb, idbKv, memoryKv } from './kv';
import { LEGACY_LS_KEY, OfflineShoppingStore, QUEUE_KEY, SNAPSHOT_KEY } from './shopping-store';

const HH = 'hh';
let n = 0;
const id = () => `off-${++n}`;
const tick = (commandId: string, itemId: string, actor = 'alice'): Command => ({ type: 'tick', commandId, actor, at: '2026-10-21T10:00:00Z', itemId });

describe('idbKv', () => {
  it('stores, reads and deletes values and survives a reopen', async () => {
    const factory = new IDBFactory();
    const a = idbKv(factory)!;
    await a.set('k', { x: 1 });
    expect(await a.get('k')).toEqual({ x: 1 });
    // A second connection to the same database sees it (a page reload).
    expect(await idbKv(factory)!.get('k')).toEqual({ x: 1 });
    await a.del('k');
    expect(await a.get('k')).toBeUndefined();
  });

  it('is null without IndexedDB, and never throws on a broken one', async () => {
    expect(idbKv(undefined as unknown as IDBFactory)).toBeNull();
    const broken = { open: () => { throw new Error('denied'); } } as unknown as IDBFactory;
    const kv = idbKv(broken)!;
    expect(await kv.get('k')).toBeUndefined();
    await expect(kv.set('k', 1)).resolves.toBeUndefined();
    await expect(kv.del('k')).resolves.toBeUndefined();
  });

  it('deleteOfflineDb wipes everything', async () => {
    const factory = new IDBFactory();
    await idbKv(factory)!.set('k', 1);
    await deleteOfflineDb(factory);
    expect(await idbKv(factory)!.get('k')).toBeUndefined();
  });
});

describe('OfflineShoppingStore', () => {
  it('persists the queue per user and restores it after a reload; an empty queue clears the record', async () => {
    const kv = memoryKv();
    const s1 = new OfflineShoppingStore(kv, 'alice');
    await s1.save([tick('c1', 'i1'), tick('c2', 'i2')]);
    expect((await new OfflineShoppingStore(kv, 'alice').load()).map((c) => c.commandId)).toEqual(['c1', 'c2']);
    await s1.save([]);
    expect(kv.data.has(QUEUE_KEY)).toBe(false);
  });

  it("never hands one user's queue to another user, and drops it", async () => {
    const kv = memoryKv();
    await new OfflineShoppingStore(kv, 'alice').save([tick('c1', 'i1')]);
    expect(await new OfflineShoppingStore(kv, 'bob').load()).toEqual([]);
    expect(kv.data.has(QUEUE_KEY)).toBe(false);
    await new OfflineShoppingStore(kv, 'alice').saveSnapshot({ cursor: 3, state: { items: {} } as never, meta: { recipeTitles: {} } });
    expect(await new OfflineShoppingStore(kv, 'bob').loadSnapshot()).toBeNull();
    expect(await new OfflineShoppingStore(kv, 'alice').loadSnapshot()).not.toBeNull();
  });

  it('ignores malformed commands in storage', async () => {
    const kv = memoryKv();
    await kv.set(QUEUE_KEY, { v: 1, userId: 'alice', commands: [{ nope: 1 }, tick('ok', 'i1'), { commandId: 'x', type: 'format_disk' }] });
    expect((await new OfflineShoppingStore(kv, 'alice').load()).map((c) => c.commandId)).toEqual(['ok']);
  });

  it('migrates the old localStorage queue once (same ids, so a replay stays idempotent)', async () => {
    const kv = memoryKv();
    const ls = new Map<string, string>([[LEGACY_LS_KEY, JSON.stringify([tick('old1', 'i1')])]]);
    const legacy = { getItem: (k: string) => ls.get(k) ?? null, removeItem: (k: string) => void ls.delete(k) };
    const store = new OfflineShoppingStore(kv, 'alice', legacy);
    await kv.set(QUEUE_KEY, { v: 1, userId: 'alice', commands: [tick('new1', 'i2'), tick('old1', 'i1')] });
    expect((await store.load()).map((c) => c.commandId)).toEqual(['new1', 'old1']); // de-duplicated by id
    expect(ls.has(LEGACY_LS_KEY)).toBe(false);
  });

  it('serialises writes: the last save wins even when saves are not awaited', async () => {
    const kv = memoryKv();
    const s = new OfflineShoppingStore(kv, 'alice');
    void s.save([tick('a', 'i1')]);
    void s.save([tick('a', 'i1'), tick('b', 'i2')]);
    await s.save([tick('c', 'i3')]);
    expect((await new OfflineShoppingStore(kv, 'alice').load()).map((c) => c.commandId)).toEqual(['c']);
  });

  it('two tabs share the queue: one tab acknowledging its commands never deletes the other ones', async () => {
    const kv = memoryKv();
    const a = new OfflineShoppingStore(kv, 'alice');
    const b = new OfflineShoppingStore(kv, 'alice');
    await a.save([tick('a1', 'i1')]);
    await b.save([tick('b1', 'i2')]);
    expect((await new OfflineShoppingStore(kv, 'alice').load()).map((c) => c.commandId)).toEqual(['a1', 'b1']);
    await a.save([]); // tab A delivered a1
    expect((await new OfflineShoppingStore(kv, 'alice').load()).map((c) => c.commandId)).toEqual(['b1']);
  });

  it('a snapshot never goes backwards for the same list', async () => {
    const kv = memoryKv();
    const s = new OfflineShoppingStore(kv, 'alice');
    const list = (cursor: number, listId = 'L1') => ({ cursor, state: { items: {} } as never, meta: { recipeTitles: {}, listId } });
    await s.saveSnapshot(list(5));
    await s.saveSnapshot(list(3)); // an older tab
    expect((await s.loadSnapshot())?.cursor).toBe(5);
    await s.saveSnapshot(list(1, 'L2')); // a different list replaces it
    expect((await s.loadSnapshot())?.meta.listId).toBe('L2');
  });

  it('clear() removes queue and snapshot', async () => {
    const kv = memoryKv();
    const s = new OfflineShoppingStore(kv, 'alice');
    await s.save([tick('a', 'i1')]);
    await s.saveSnapshot({ cursor: 1, state: { items: {} } as never, meta: { recipeTitles: {} } });
    await s.clear();
    expect(kv.data.has(QUEUE_KEY)).toBe(false);
    expect(kv.data.has(SNAPSHOT_KEY)).toBe(false);
  });
});

function world() {
  const repo = new InMemoryShoppingRepository();
  const online = { value: true };
  const transport: Transport = {
    sync: async (cmds, cursor) => {
      if (!online.value) throw new Error('offline');
      return syncList(repo, HH, cmds, cursor);
    },
    snapshot: async () => repo.snapshot(HH),
  };
  const factory = new IDBFactory();
  const notices: Notice[] = [];
  /** A browser tab: a controller over the device's IndexedDB. Closing the tab = dropping the controller. */
  const tab = async (user = 'alice') => {
    const store = new OfflineShoppingStore(idbKv(factory), user);
    const c = new ShoppingController(await repo.snapshot(HH), {
      transport, store, snapshots: store.snapshots, actor: () => user, newId: id, onNotice: (x) => notices.push(x),
    });
    return { c, store };
  };
  return { repo, online, tab, notices, factory };
}

const drain = async (store: OfflineShoppingStore) => {
  await store.whenIdle();
  return (await store.load()).map((c) => c.commandId);
};
const settle = () => new Promise((r) => setTimeout(r, 20));

describe('offline queue replay (IndexedDB, same engine semantics as Android)', () => {
  it('ticks made offline survive a reload and replay once on reconnect', async () => {
    const w = world();
    const { c: seed } = await w.tab();
    const itemId = seed.addItem({ displayName: 'Rice', category: 'Dry goods', quantity: { kind: 'exact', value: 500, unit: 'g', originalText: '500 g' } });
    await seed.sync();

    w.online.value = false;
    const first = await w.tab();
    first.c.restore();
    const eventId = first.c.tick(itemId); // optimistic + queued
    await first.c.sync();
    expect(first.c.getState().status).toBe('offline');
    expect(first.c.getState().pendingCount).toBe(1);
    expect(activeView(first.c.getState().view, defaultEngineContext)).toHaveLength(0); // shown as done at once
    expect(await drain(first.store)).toEqual([eventId]); // on disk

    // Close the tab, reopen it still offline: the queue comes back from IndexedDB and the tick still shows.
    const second = await w.tab();
    await second.c.restore();
    expect(second.c.getState().pendingCount).toBe(1);
    expect(activeView(second.c.getState().view, defaultEngineContext)).toHaveLength(0);

    // Reconnect: replay; the server records the purchase once even if the replay is repeated.
    w.online.value = true;
    await second.c.sync();
    await second.c.sync();
    expect(second.c.getState().pendingCount).toBe(0);
    expect(second.c.getState().status).toBe('synced');
    expect(await drain(second.store)).toEqual([]);
    const snap = await w.repo.snapshot(HH);
    expect(Object.values(snap.state.events).filter((e) => e.shoppingListItemId === itemId)).toHaveLength(1);
  });

  it('replays in order and a lost race shows a conflict notice, not a double purchase', async () => {
    const w = world();
    const { c: seed } = await w.tab('alice');
    const itemId = seed.addItem({ displayName: 'Milk', category: 'Dairy', quantity: { kind: 'exact', value: 1, unit: 'item', originalText: '1' } });
    await seed.sync();

    w.online.value = false;
    const bob = await w.tab('bob');
    await bob.c.restore();
    bob.c.tick(itemId);
    await bob.c.sync();
    w.online.value = true;
    const alice = await w.tab('alice');
    alice.c.tick(itemId); // alice gets there first
    await alice.c.sync();

    await bob.c.sync();
    expect(bob.c.getState().pendingCount).toBe(0);
    expect(w.notices.some((x) => x.kind === 'conflict' || x.kind === 'rejected')).toBe(true);
    const snap = await w.repo.snapshot(HH);
    expect(Object.values(snap.state.events).filter((e) => e.shoppingListItemId === itemId)).toHaveLength(1);
  });

  it("a different user on the same browser never replays the previous user's queue", async () => {
    const w = world();
    const { c: seed } = await w.tab();
    const itemId = seed.addItem({ displayName: 'Eggs', category: 'Dairy', quantity: { kind: 'exact', value: 6, unit: 'item', originalText: '6' } });
    await seed.sync();
    w.online.value = false;
    const alice = await w.tab('alice');
    alice.c.tick(itemId);
    await alice.c.sync();
    await settle();
    w.online.value = true;
    const bob = await w.tab('bob');
    await bob.c.restore();
    expect(bob.c.getState().pendingCount).toBe(0);
    await bob.c.sync();
    const snap = await w.repo.snapshot(HH);
    expect(Object.values(snap.state.events).filter((e) => e.shoppingListItemId === itemId)).toHaveLength(0);
  });

  it('keeps the last confirmed list on the device and adopts it over an older cached page', async () => {
    const w = world();
    const { c: seed } = await w.tab();
    seed.addItem({ displayName: 'Tea', category: 'Dry goods' });
    await seed.sync();

    // The tab loads (page rendered with this snapshot), syncs online: the snapshot is stored.
    const a = await w.tab();
    const stale = a.c.getState().client.cursor;
    seed.addItem({ displayName: 'Coffee', category: 'Dry goods' });
    await seed.sync();
    await a.c.sync();
    await settle();
    const stored = await a.store.loadSnapshot();
    expect(stored?.cursor).toBeGreaterThan(stale);

    // Later the browser serves the OLD page from its cache while offline: the controller adopts the newer on-device list.
    w.online.value = false;
    const b = new ShoppingController(
      { cursor: stale, state: (await w.tab()).c.getState().client.confirmed, meta: stored!.meta },
      { transport: { sync: async () => { throw new Error('offline'); }, snapshot: async () => { throw new Error('offline'); } }, store: a.store, snapshots: a.store.snapshots, actor: () => 'alice', newId: id },
    );
    const staleNames = Object.values(b.getState().view.items).map((i) => i.displayName);
    b.start();
    await settle();
    b.stop();
    const names = Object.values(b.getState().view.items).map((i) => i.displayName).sort();
    expect(names).toEqual(expect.arrayContaining(['Coffee', 'Tea']));
    expect(staleNames.length).toBeLessThanOrEqual(names.length);
    expect(b.getState().status).toBe('offline');
  });

  it('a page rendered before the household had any list adopts the list the device saved later', async () => {
    const w = world();
    const { c: seed, store } = await w.tab();
    seed.addItem({ displayName: 'Bread', category: 'Bakery' });
    await seed.sync();
    await store.whenIdle();
    const saved = await store.loadSnapshot();
    expect(saved).not.toBeNull();
    // The cached page was rendered when there was no list yet: no list id, an empty state, cursor 0.
    const emptyPage = { cursor: 0, state: { ...saved!.state, items: {}, itemOrder: [], events: {}, eventOrder: [], outcomes: {} }, meta: { recipeTitles: {} } };
    const offlineTransport: Transport = { sync: async () => { throw new Error('offline'); }, snapshot: async () => { throw new Error('offline'); } };
    const c = new ShoppingController(emptyPage as never, { transport: offlineTransport, store, snapshots: store.snapshots, actor: () => 'alice', newId: id });
    c.start();
    await settle();
    c.stop();
    expect(Object.values(c.getState().view.items).map((i) => i.displayName)).toEqual(['Bread']);
    expect(c.getState().meta.listId).toBe(saved!.meta.listId);
  });

  it('works with no IndexedDB at all: the list still functions in memory', async () => {
    const w = world();
    const store = new OfflineShoppingStore(null, 'alice');
    const c = new ShoppingController(await w.repo.snapshot(HH), { transport: { sync: async (cmds, cur) => syncList(w.repo, HH, cmds, cur), snapshot: async () => w.repo.snapshot(HH) }, store, snapshots: store.snapshots, actor: () => 'alice', newId: id });
    c.addItem({ displayName: 'Salt', category: 'Dry goods' });
    await c.sync();
    expect(c.getState().pendingCount).toBe(0);
  });
});
