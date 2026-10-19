// Realtime client logic (D122) with a fake channel: subscribe filter, status -> live/down, backoff re-subscribe,
// stale-generation events ignored; and the controller: Realtime replaces polling, polling only while it is down,
// every (re)subscription catches up from the cursor, echoes at or below the cursor are skipped.
import { describe, expect, it } from 'vitest';
import type { Command } from './engine';
import { ShoppingController, type PendingStore, type Transport } from './controller';
import { createSupabaseLiveFeed, type ChannelLike, type LiveFeed, type LiveStatus, type RealtimeClientLike } from './live';
import { InMemoryShoppingRepository } from '../server/shopping/repository';
import { syncList } from '../server/shopping/service';

class FakeChannel implements ChannelLike {
  handler?: (p: { new?: Record<string, unknown> }) => void;
  statusCb?: (s: string) => void;
  filter?: unknown;
  removed = false;
  constructor(readonly name: string) {}
  on(_t: 'postgres_changes', filter: unknown, cb: (p: { new?: Record<string, unknown> }) => void) {
    this.filter = filter;
    this.handler = cb;
    return this;
  }
  subscribe(cb?: (s: string) => void) {
    this.statusCb = cb;
    return this;
  }
  emit(row: Record<string, unknown>) { this.handler?.({ new: row }); }
  status(s: string) { this.statusCb?.(s); }
}

function fakeClient() {
  const channels: FakeChannel[] = [];
  const client: RealtimeClientLike = {
    channel: (name) => { const c = new FakeChannel(name); channels.push(c); return c; },
    removeChannel: (c) => { (c as FakeChannel).removed = true; },
  };
  return { client, channels };
}

function fakeTimers() {
  const pending: Array<{ fn: () => void; ms: number }> = [];
  return {
    pending,
    setTimer: (fn: () => void, ms: number) => { const t = { fn, ms }; pending.push(t); return t; },
    clearTimer: (h: unknown) => { const i = pending.indexOf(h as never); if (i >= 0) pending.splice(i, 1); },
    fire: () => { const t = pending.shift(); t?.fn(); return t?.ms; },
  };
}

describe('createSupabaseLiveFeed', () => {
  it('subscribes to INSERTs on the household command log and reports live / changes', () => {
    const { client, channels } = fakeClient();
    const statuses: LiveStatus[] = [];
    const seqs: Array<number | undefined> = [];
    const stop = createSupabaseLiveFeed(client, 'hh-1').start((s) => seqs.push(s), (s) => statuses.push(s));
    expect(channels).toHaveLength(1);
    expect(channels[0]!.filter).toEqual({ event: 'INSERT', schema: 'public', table: 'shopping_command_log', filter: 'household_id=eq.hh-1' });
    channels[0]!.status('SUBSCRIBED');
    channels[0]!.emit({ list_seq: 4 });
    channels[0]!.emit({});
    expect(statuses).toEqual(['down', 'live']);
    expect(seqs).toEqual([4, undefined]);
    stop();
    expect(channels[0]!.removed).toBe(true);
    channels[0]!.emit({ list_seq: 5 }); // after stop: ignored
    expect(seqs).toHaveLength(2);
  });

  it('re-subscribes with backoff after an error / timeout / close; old channels are ignored', () => {
    const { client, channels } = fakeClient();
    const t = fakeTimers();
    const statuses: LiveStatus[] = [];
    const seqs: number[] = [];
    const stop = createSupabaseLiveFeed(client, 'hh', { retryMs: 100, maxRetryMs: 300, setTimer: t.setTimer, clearTimer: t.clearTimer })
      .start((s) => s !== undefined && seqs.push(s), (s) => statuses.push(s));
    channels[0]!.status('CHANNEL_ERROR');
    expect(statuses).toEqual(['down', 'down']);
    expect(t.fire()).toBe(100);
    expect(channels).toHaveLength(2);
    expect(channels[0]!.removed).toBe(true);
    channels[0]!.emit({ list_seq: 1 }); // stale generation
    channels[1]!.status('TIMED_OUT');
    expect(t.fire()).toBe(200);
    channels[2]!.status('CLOSED');
    expect(t.fire()).toBe(300); // capped
    channels[3]!.status('SUBSCRIBED');
    channels[3]!.emit({ list_seq: 9 });
    expect(statuses.at(-1)).toBe('live');
    expect(seqs).toEqual([9]);
    channels[3]!.status('CHANNEL_ERROR');
    expect(t.pending[0]!.ms).toBe(100); // a successful subscribe resets the backoff
    stop();
    expect(t.pending).toHaveLength(0);
  });
});

/** A feed the test drives by hand. */
function manualFeed() {
  let change: ((seq?: number) => void) | undefined;
  let status: ((s: LiveStatus) => void) | undefined;
  let stopped = false;
  const feed: LiveFeed = {
    start(c, s) { change = c; status = s; s('down'); return () => { stopped = true; }; },
  };
  return { feed, change: (seq?: number) => change?.(seq), status: (s: LiveStatus) => status?.(s), stopped: () => stopped };
}

function controllerFor(repo: InMemoryShoppingRepository, live?: LiveFeed) {
  let syncs = 0;
  const transport: Transport = {
    sync: async (cmds, cursor) => { syncs++; return syncList(repo, 'hh', cmds, cursor); },
    snapshot: async () => repo.snapshot('hh'),
  };
  let saved: Command[] = [];
  const store: PendingStore = { load: () => saved, save: (p) => { saved = p; } };
  const intervals: Array<() => void> = [];
  let n = 0;
  return {
    syncs: () => syncs,
    intervals,
    make: async () => new ShoppingController(await repo.snapshot('hh'), {
      transport, store, actor: () => 'alice', newId: () => `id-${++n}`,
      setInterval: (fn) => { intervals.push(fn); return fn; },
      clearInterval: (h) => { const i = intervals.indexOf(h as () => void); if (i >= 0) intervals.splice(i, 1); },
      ...(live ? { live } : {}),
    }),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('ShoppingController with Realtime', () => {
  it('without a feed (mock mode) it polls', async () => {
    const h = controllerFor(new InMemoryShoppingRepository());
    const c = await h.make();
    const stop = c.start();
    expect(c.polling).toBe(true);
    stop();
    expect(c.polling).toBe(false);
  });

  it('polls only while Realtime is down; each (re)subscribe catches up from the cursor; changes trigger a sync', async () => {
    const repo = new InMemoryShoppingRepository();
    const f = manualFeed();
    const h = controllerFor(repo, f.feed);
    const c = await h.make();
    c.start();
    await flush();
    expect(c.polling).toBe(true); // not subscribed yet: fallback poll
    const before = h.syncs();
    f.status('live');
    await flush();
    expect(c.polling).toBe(false);
    expect(h.syncs()).toBe(before + 1); // catch-up after (re)subscribe

    // another shopper writes -> server log grows -> Realtime pokes -> we fetch and see it
    await repo.submit('hh', { type: 'add_item', commandId: 'x1', actor: 'bob', at: '2026-10-19T10:00:00.000Z', itemId: 'i1', displayName: 'Milk', category: 'Dairy & eggs' });
    f.change(1);
    await flush();
    await c.sync();
    expect(c.getState().client.cursor).toBe(1);
    expect(c.getState().view.items.i1).toBeDefined();

    // an echo at/below the cursor with nothing pending is skipped
    const n = h.syncs();
    f.change(1);
    await flush();
    expect(h.syncs()).toBe(n);

    f.status('down');
    expect(c.polling).toBe(true);
    h.intervals[0]!(); // the fallback poll still syncs
    await flush();
    expect(h.syncs()).toBe(n + 1);
    f.status('live');
    expect(c.polling).toBe(false);
    c.stop();
    expect(f.stopped()).toBe(true);
  });

  it('a superseded rejection (server retried the tick under a derived id) is never shown', async () => {
    const repo = new InMemoryShoppingRepository();
    const notices: unknown[] = [];
    const c = new ShoppingController(await repo.snapshot('hh'), {
      transport: { sync: async () => ({ cursor: 1, entries: [{ seq: 1, command: { type: 'tick', commandId: 't1', actor: 'alice', at: 'x', itemId: 'i' }, result: { commandId: 't1', type: 'tick', status: 'rejected', reason: 'superseded', itemId: 'i' } }], results: [], dropped: [], meta: { recipeTitles: {} } }), snapshot: async () => repo.snapshot('hh') },
      store: { load: () => [], save: () => undefined }, actor: () => 'alice', newId: () => 't1', onNotice: (x) => notices.push(x),
    });
    c.tick('i');
    await c.sync();
    expect(c.getState().pendingCount).toBe(0);
    expect(notices).toEqual([]);
  });
});
