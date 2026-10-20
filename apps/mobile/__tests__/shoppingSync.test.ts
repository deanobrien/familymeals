import { SupabaseDataSource } from '@/data/supabaseDataSource';
import { OfflineStore, type KeyValueStore } from '@/data/offlineQueue';
import type { LiveFeed, LiveStatus } from '@/data/liveFeed';
import { FakeBackend, HH, LIST, uid } from './helpers/fakeSupabase';

function memoryKv(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => void data.set(k, v),
    removeItem: async (k) => void data.delete(k),
  };
}

function setup(backend = new FakeBackend(), kv = memoryKv(), extra: Partial<ConstructorParameters<typeof SupabaseDataSource>[0]> = {}) {
  let n = 1000;
  const make = (more: Partial<ConstructorParameters<typeof SupabaseDataSource>[0]> = {}) =>
    new SupabaseDataSource({
      client: backend.asClient(),
      store: new OfflineStore(kv),
      newId: () => uid(n++),
      now: () => new Date('2026-10-19T12:00:00Z'),
      ...extra,
      ...more,
    });
  return { backend, kv, ds: make(), make };
}

const ids = { milk: uid(1), eggs: uid(2), flour: uid(3) };
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(cond()).toBe(true);
};
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

describe('per-list list_seq cursor (D210)', () => {
  it('uses list_seq (not the global seq) as the cursor and persists it per list', async () => {
    const { ds, backend, kv } = setup();
    backend.otherUserTick(ids.eggs, uid(5001)); // list_seq 1 (global seq is 1001: they must not be confused)
    await ds.getShoppingList(HH);
    const stored = JSON.parse(kv.data.get(`fr.shopping.v2.list.${LIST}`) as string) as { cursor: number };
    expect(stored.cursor).toBe(1);
    expect(JSON.parse(kv.data.get(`fr.shopping.v2.active.${HH}`) as string)).toMatchObject({ listId: LIST });

    backend.otherUserTick(ids.milk, uid(5002)); // list_seq 2
    const s = await ds.getShoppingList(HH);
    expect(s.items.filter((i) => i.ticked).map((i) => i.id).sort()).toEqual([ids.eggs, ids.milk].sort());
    expect(backend.snapshotCalls).toBe(1);
    expect((JSON.parse(kv.data.get(`fr.shopping.v2.list.${LIST}`) as string) as { cursor: number }).cursor).toBe(2);
  });

  it('a snapshot already containing a command does not replay it twice (head = cursor)', async () => {
    const { ds, backend } = setup();
    backend.otherUserPurchase(ids.flour, uid(5003), 400, 'g');
    await ds.getShoppingList(HH);
    backend.otherUserTick(ids.eggs, uid(5004));
    const s = await ds.getShoppingList(HH);
    // Flour is 1 kg - 400 g once, not twice.
    expect(s.items.find((i) => i.id === ids.flour)?.quantity).toMatchObject({ value: 0.6, unit: 'kg' });
    expect(backend.snapshotCalls).toBe(1);
  });

  it('a gap in list_seq falls back to one fresh snapshot (no wrong state)', async () => {
    const { ds, backend } = setup();
    await ds.getShoppingList(HH);
    backend.otherUserTick(ids.eggs, uid(5005)); // list_seq 1
    backend.otherUserTick(ids.milk, uid(5006)); // list_seq 2
    backend.tables.shopping_command_log!.splice(0, 1); // the client can never see list_seq 1
    const s = await ds.getShoppingList(HH);
    expect(backend.snapshotCalls).toBe(2);
    expect(s.items.filter((i) => i.ticked)).toHaveLength(2); // both events come from the snapshot rows
    // And it is back in step: the next change is incremental.
    backend.otherUserTick(ids.flour, uid(5007));
    await ds.getShoppingList(HH);
    expect(backend.snapshotCalls).toBe(2);
  });

  it('rebuilds from a snapshot when the active list changes', async () => {
    const { ds, backend } = setup();
    await ds.getShoppingList(HH);
    const LIST2 = uid(201);
    backend.tables.shopping_lists!.push({ id: LIST2, household_id: HH, status: 'active', created_at: '2026-10-05T00:00:00Z' });
    backend.tables.shopping_lists![0]!.status = 'archived';
    const milk = backend.tables.shopping_list_items![0]!;
    backend.tables.shopping_list_items!.push({ ...milk, id: uid(88), shopping_list_id: LIST2, display_name: 'Tea', item_key: 'name:tea' });
    const s = await ds.getShoppingList(HH);
    expect(s.items.map((i) => i.displayName)).toEqual(['Tea']);
    expect(backend.snapshotCalls).toBe(2);
  });

  it('cold start online resumes from the persisted cursor instead of a full snapshot', async () => {
    const { ds, backend, make } = setup();
    await ds.getShoppingList(HH);
    backend.otherUserTick(ids.eggs, uid(5008));

    const restarted = make();
    const s = await restarted.getShoppingList(HH);
    expect(backend.snapshotCalls).toBe(1); // only the very first load took a snapshot
    expect(s.items.find((i) => i.id === ids.eggs)?.ticked).toBe(true);
  });

  it('ignores v1 caches (their cursor was the global seq) but keeps their queued ticks', async () => {
    const backend = new FakeBackend();
    const kv = memoryKv();
    kv.data.set(`fr.shopping.v1.snapshot.${HH}`, JSON.stringify({ listId: LIST, cursor: 999, state: { items: {}, itemOrder: [], events: {}, eventOrder: [], voids: {}, outcomes: {} }, members: {} }));
    kv.data.set(`fr.shopping.v1.pending.${HH}`, JSON.stringify([{ type: 'tick', commandId: uid(6000), actor: uid(901), at: '2026-10-19T10:00:00Z', itemId: ids.milk }]));
    const { ds } = setup(backend, kv);
    const s = await ds.getShoppingList(HH);
    expect(backend.snapshotCalls).toBe(1);
    expect(backend.tables.purchase_events).toHaveLength(1); // the legacy queued tick was delivered
    expect(s.items.find((i) => i.id === ids.milk)?.ticked).toBe(true);
    expect(kv.data.has(`fr.shopping.v1.pending.${HH}`)).toBe(false);
  });

  it('offline cold start uses the cached list and cursor with no network at all', async () => {
    const { ds, backend, make } = setup();
    await ds.getShoppingList(HH);
    backend.offline = true;
    const restarted = make();
    restarted.setOnline(false);
    const calls = backend.snapshotCalls;
    const s = await restarted.getShoppingList(HH);
    expect(s.items).toHaveLength(4);
    expect(backend.snapshotCalls).toBe(calls);
  });
});

describe('Realtime catch-up (D211)', () => {
  afterEach(() => jest.useRealTimers());

  it('catches up once the subscription is confirmed, then on every insert, and stops cleanly', async () => {
    const { ds, backend } = setup();
    await ds.getShoppingList(HH);
    const seen: number[] = [];
    let calls = 0;
    const stop = ds.watchShopping(HH, () => {
      calls += 1;
      void ds.getShoppingList(HH).then((s) => seen.push(s.items.filter((i) => i.ticked).length));
    });
    await flush();
    expect(backend.channelsOpen).toBe(1);
    expect(calls).toBe(1); // confirmed-subscription catch-up
    backend.otherUserTick(ids.eggs, uid(5009)); // realtime INSERT while subscribed
    await flush();
    expect(calls).toBe(2);
    await until(() => seen[seen.length - 1] === 1);
    stop();
    expect(backend.channelsOpen).toBe(0);
    backend.otherUserTick(ids.milk, uid(5010));
    await flush();
    expect(calls).toBe(2); // no listener after stop
  });

  it('a change committed between SUBSCRIBED and the server confirmation is picked up by the catch-up', async () => {
    const { ds, backend } = setup();
    await ds.getShoppingList(HH);
    backend.realtimeConfirms = false; // SUBSCRIBED arrives, confirmation does not (yet)
    let calls = 0;
    const stop = ds.watchShopping(HH, () => (calls += 1));
    await flush();
    expect(calls).toBe(0); // not live yet: nothing to claim
    backend.otherUserTick(ids.eggs, uid(5011)); // the event may be lost in this window...
    const s = await ds.getShoppingList(HH); // ...but the cursor catch-up still sees it
    expect(s.items.find((i) => i.id === ids.eggs)?.ticked).toBe(true);
    stop();
  });

  it('polls only while the feed is down and we are online', async () => {
    jest.useFakeTimers();
    let report: (s: LiveStatus) => void = () => undefined;
    const feed: LiveFeed = {
      start: (_c, onStatus) => {
        report = onStatus;
        onStatus('down');
        return () => undefined;
      },
    };
    const ds2 = new SupabaseDataSource({ client: new FakeBackend().asClient(), store: new OfflineStore(memoryKv()), pollMs: 1000, feedFactory: () => feed });
    let polls = 0;
    const stop = ds2.watchShopping(HH, () => (polls += 1));
    jest.advanceTimersByTime(3000);
    expect(polls).toBe(3); // down: polling
    report('live'); // confirmed -> one catch-up, polling stops
    expect(polls).toBe(4);
    jest.advanceTimersByTime(5000);
    expect(polls).toBe(4);
    report('down');
    ds2.setOnline(false);
    jest.advanceTimersByTime(3000);
    expect(polls).toBe(4); // offline: no polling
    ds2.setOnline(true);
    jest.advanceTimersByTime(1000);
    expect(polls).toBe(5);
    stop();
    jest.advanceTimersByTime(5000);
    expect(polls).toBe(5);
  });

  it('re-subscribes after the channel drops and catches up again once confirmed', async () => {
    jest.useFakeTimers();
    const { ds, backend } = setup();
    await ds.getShoppingList(HH);
    let calls = 0;
    const stop = ds.watchShopping(HH, () => (calls += 1));
    await flush();
    expect(calls).toBe(1);
    backend.dropRealtime('CLOSED');
    await flush();
    jest.advanceTimersByTime(2100); // retry backoff
    await flush();
    expect(backend.channelLog.filter((l) => l.startsWith('subscribe:'))).toHaveLength(2);
    expect(calls).toBeGreaterThanOrEqual(2); // fresh confirmation -> catch-up
    stop();
  });
});
