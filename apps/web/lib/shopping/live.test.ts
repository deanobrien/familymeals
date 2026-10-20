// Realtime client logic (D122, D200-D203) with a fake channel: subscribe filter, live only after the server confirms the
// postgres_changes listener (not at SUBSCRIBED), the join->confirm gap race, backoff re-subscribe, stale-generation
// events ignored, token refresh, tab sleep / online recovery; and the controller: Realtime replaces polling, polling
// continues until confirmed, every (re)confirmation catches up from the cursor twice, no duplicate application.
import { describe, expect, it } from 'vitest';
import type { Command } from './engine';
import { ShoppingController, type PendingStore, type Transport } from './controller';
import { createSupabaseLiveFeed, type ChannelLike, type LiveFeed, type LiveStatus, type RealtimeClientLike } from './live';
import { InMemoryShoppingRepository } from '../server/shopping/repository';
import { syncList } from '../server/shopping/service';

type SysMsg = { extension?: string; status?: string; message?: string };

class FakeChannel implements ChannelLike {
  handler?: (p: { new?: Record<string, unknown> }) => void;
  sysCb?: (m: SysMsg) => void;
  statusCb?: (s: string) => void;
  filter?: unknown;
  removed = false;
  constructor(readonly name: string) {}
  on(type: 'postgres_changes' | 'system', filter: unknown, cb: unknown) {
    if (type === 'system') this.sysCb = cb as (m: SysMsg) => void;
    else {
      this.filter = filter;
      this.handler = cb as (p: { new?: Record<string, unknown> }) => void;
    }
    return this;
  }
  subscribe(cb?: (s: string) => void) {
    this.statusCb = cb;
    return this;
  }
  emit(row: Record<string, unknown>) { this.handler?.({ new: row }); }
  status(s: string) { this.statusCb?.(s); }
  /** The server confirming (or refusing) the postgres_changes listener. */
  confirm(status = 'ok') { this.sysCb?.({ extension: 'postgres_changes', status }); }
}

function fakeClient() {
  const channels: FakeChannel[] = [];
  const authCbs: Array<(event: string, session: { access_token?: string } | null) => void> = [];
  const setAuthCalls: Array<string | null | undefined> = [];
  let unsubscribed = 0;
  const client: RealtimeClientLike = {
    channel: (name) => { const c = new FakeChannel(name); channels.push(c); return c; },
    removeChannel: (c) => { (c as FakeChannel).removed = true; },
    realtime: { setAuth: (t) => { setAuthCalls.push(t); } },
    auth: {
      onAuthStateChange: (cb) => {
        authCbs.push(cb);
        return { data: { subscription: { unsubscribe: () => { unsubscribed++; } } } };
      },
    },
  };
  return { client, channels, authCbs, setAuthCalls, unsubscribed: () => unsubscribed };
}

function fakeTimers() {
  const pending: Array<{ fn: () => void; ms: number }> = [];
  return {
    pending,
    setTimer: (fn: () => void, ms: number) => { const t = { fn, ms }; pending.push(t); return t; },
    clearTimer: (h: unknown) => { const i = pending.indexOf(h as never); if (i >= 0) pending.splice(i, 1); },
    /** Fire the earliest-registered timer with this delay. */
    fireMs: (ms: number) => { const i = pending.findIndex((t) => t.ms === ms); if (i < 0) return false; const [t] = pending.splice(i, 1); t!.fn(); return true; },
  };
}

function fakeEnv() {
  const handlers: Record<string, Array<() => void>> = { online: [], visible: [] };
  return {
    environment: {
      on: (e: 'online' | 'visible', fn: () => void) => { handlers[e]!.push(fn); return () => { handlers[e] = handlers[e]!.filter((f) => f !== fn); }; },
    },
    fire: (e: 'online' | 'visible') => handlers[e]!.slice().forEach((f) => f()),
    count: (e: 'online' | 'visible') => handlers[e]!.length,
  };
}

function feedHarness(extra: Parameters<typeof createSupabaseLiveFeed>[2] = {}) {
  const c = fakeClient();
  const t = fakeTimers();
  const env = fakeEnv();
  let clock = 0;
  const statuses: LiveStatus[] = [];
  const changes: Array<number | undefined> = [];
  const stop = createSupabaseLiveFeed(c.client, 'hh', {
    retryMs: 100, maxRetryMs: 300, confirmMs: 5000, heartbeatMs: 1000,
    setTimer: t.setTimer, clearTimer: t.clearTimer, environment: env.environment, now: () => clock, ...extra,
  }).start((s) => changes.push(s), (s) => statuses.push(s));
  return { ...c, t, env, statuses, changes, stop, advance: (ms: number) => { clock += ms; } };
}

describe('createSupabaseLiveFeed', () => {
  it('subscribes to INSERTs on the household command log; live only once postgres_changes is confirmed', () => {
    const { client, channels } = fakeClient();
    const statuses: LiveStatus[] = [];
    const seqs: Array<number | undefined> = [];
    const stop = createSupabaseLiveFeed(client, 'hh-1').start((s) => seqs.push(s), (s) => statuses.push(s));
    expect(channels).toHaveLength(1);
    expect(channels[0]!.filter).toEqual({ event: 'INSERT', schema: 'public', table: 'shopping_command_log', filter: 'household_id=eq.hh-1' });
    channels[0]!.status('SUBSCRIBED');
    expect(statuses).toEqual(['down']); // joined, but the listener is not confirmed yet: still down (keep polling)
    channels[0]!.confirm();
    channels[0]!.emit({ list_seq: 4 });
    channels[0]!.emit({});
    expect(statuses).toEqual(['down', 'live']);
    expect(seqs).toEqual([4, undefined]);
    stop();
    expect(channels[0]!.removed).toBe(true);
    channels[0]!.emit({ list_seq: 5 }); // after stop: ignored
    expect(seqs).toHaveLength(2);
  });

  it('the join->confirm gap: not live at SUBSCRIBED, so the controller keeps polling and the gap commit is fetched', () => {
    const h = feedHarness();
    const ch = h.channels[0]!;
    ch.status('SUBSCRIBED');
    // a row committed here is pushed to nobody (listener not active yet): no event arrives, and we are NOT live
    expect(h.statuses).toEqual(['down']);
    ch.confirm();
    expect(h.statuses).toEqual(['down', 'live']); // controller reacts to this with catch-up #1 and #2
    expect(h.changes).toEqual([]);
  });

  it('a join that is never confirmed is torn down and retried (never silently live)', () => {
    const h = feedHarness();
    h.channels[0]!.status('SUBSCRIBED');
    expect(h.t.fireMs(5000)).toBe(true); // confirm timeout
    expect(h.channels[0]!.removed).toBe(true);
    expect(h.statuses).toEqual(['down']);
    expect(h.t.fireMs(100)).toBe(true);
    expect(h.channels).toHaveLength(2);
    h.channels[1]!.status('SUBSCRIBED');
    h.channels[1]!.confirm();
    expect(h.statuses).toEqual(['down', 'live']);
    expect(h.t.pending.some((x) => x.ms === 5000)).toBe(false); // confirm timer cleared
  });

  it('a refused postgres_changes listener is a failure: down + backoff retry', () => {
    const h = feedHarness();
    h.channels[0]!.status('SUBSCRIBED');
    h.channels[0]!.confirm('error');
    expect(h.statuses).toEqual(['down']);
    expect(h.t.pending.some((x) => x.ms === 100)).toBe(true);
  });

  it('re-subscribes with backoff after an error / timeout / close; old channels are ignored; confirmation resets backoff', () => {
    const h = feedHarness();
    const seqs: number[] = [];
    h.channels[0]!.status('CHANNEL_ERROR');
    expect(h.statuses).toEqual(['down']);
    expect(h.t.fireMs(100)).toBe(true);
    expect(h.channels).toHaveLength(2);
    expect(h.channels[0]!.removed).toBe(true);
    h.channels[0]!.emit({ list_seq: 1 }); // stale generation
    h.channels[1]!.status('TIMED_OUT');
    expect(h.t.fireMs(200)).toBe(true);
    h.channels[2]!.status('CLOSED');
    expect(h.t.fireMs(300)).toBe(true); // capped
    h.channels[3]!.status('SUBSCRIBED');
    h.channels[3]!.confirm();
    expect(h.statuses.at(-1)).toBe('live');
    h.channels[3]!.emit({ list_seq: 9 });
    expect(h.changes).toEqual([9]);
    seqs.push(...h.changes.filter((x): x is number => x !== undefined));
    h.channels[3]!.status('CHANNEL_ERROR');
    expect(h.statuses.at(-1)).toBe('down');
    expect(h.t.pending.some((x) => x.ms === 100)).toBe(true); // a confirmed subscribe resets the backoff
    h.stop();
    expect(h.t.pending).toHaveLength(0);
    expect(seqs).toEqual([9]);
  });

  it('resubscribe: each new channel must be confirmed again before reporting live again', () => {
    const h = feedHarness();
    h.channels[0]!.status('SUBSCRIBED');
    h.channels[0]!.confirm();
    h.channels[0]!.status('CLOSED');
    expect(h.statuses).toEqual(['down', 'live', 'down']);
    h.t.fireMs(100);
    h.channels[1]!.status('SUBSCRIBED');
    expect(h.statuses).toEqual(['down', 'live', 'down']); // not yet
    h.channels[1]!.confirm();
    expect(h.statuses).toEqual(['down', 'live', 'down', 'live']);
  });

  it('token refresh: the new JWT is pushed to the socket and a catch-up is requested; unsubscribed on stop', () => {
    const h = feedHarness();
    h.channels[0]!.status('SUBSCRIBED');
    h.channels[0]!.confirm();
    h.authCbs[0]!('TOKEN_REFRESHED', { access_token: 'jwt-2' });
    expect(h.setAuthCalls).toEqual(['jwt-2']);
    expect(h.changes).toEqual([undefined]);
    h.authCbs[0]!('TOKEN_REFRESHED', null); // no session: ignored
    h.authCbs[0]!('USER_UPDATED', { access_token: 'x' }); // irrelevant event
    expect(h.setAuthCalls).toEqual(['jwt-2']);
    h.stop();
    expect(h.unsubscribed()).toBe(1);
    h.authCbs[0]!('TOKEN_REFRESHED', { access_token: 'jwt-3' }); // after stop: ignored
    expect(h.setAuthCalls).toEqual(['jwt-2']);
  });

  it('heartbeat while live asks for a catch-up; a long gap (tab/laptop slept) forces a reconnect without backoff', () => {
    const h = feedHarness();
    h.channels[0]!.status('SUBSCRIBED');
    h.channels[0]!.confirm();
    h.advance(1000);
    h.t.fireMs(1000);
    expect(h.changes).toEqual([undefined]);
    expect(h.channels).toHaveLength(1);
    h.advance(10_000); // slept
    h.t.fireMs(1000);
    expect(h.statuses.at(-1)).toBe('down');
    expect(h.channels).toHaveLength(2); // reconnected immediately
    expect(h.channels[0]!.removed).toBe(true);
  });

  it('browser back online / tab visible: reconnect now if down, catch up if live; listeners removed on stop', () => {
    const h = feedHarness();
    h.channels[0]!.status('CHANNEL_ERROR'); // offline: retry scheduled
    h.env.fire('online');
    expect(h.channels).toHaveLength(2); // no waiting for the backoff
    expect(h.t.pending.some((x) => x.ms === 100)).toBe(false);
    h.channels[1]!.status('SUBSCRIBED');
    h.channels[1]!.confirm();
    h.env.fire('visible');
    h.env.fire('online');
    expect(h.channels).toHaveLength(2);
    expect(h.changes).toEqual([undefined, undefined]);
    h.stop();
    expect(h.env.count('online') + h.env.count('visible')).toBe(0);
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
  const timeouts: Array<() => void> = [];
  let n = 0;
  return {
    syncs: () => syncs,
    intervals,
    timeouts,
    make: async () => new ShoppingController(await repo.snapshot('hh'), {
      transport, store, actor: () => 'alice', newId: () => `id-${++n}`,
      setInterval: (fn) => { intervals.push(fn); return fn; },
      clearInterval: (h) => { const i = intervals.indexOf(h as () => void); if (i >= 0) intervals.splice(i, 1); },
      setTimeout: (fn) => { timeouts.push(fn); return fn; },
      clearTimeout: (h) => { const i = timeouts.indexOf(h as () => void); if (i >= 0) timeouts.splice(i, 1); },
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

  it('gap race: a row committed between join and confirmation is fetched by the catch-ups, applied exactly once', async () => {
    const repo = new InMemoryShoppingRepository();
    const f = manualFeed();
    const h = controllerFor(repo, f.feed);
    const c = await h.make();
    c.start();
    await flush();
    // channel joined (SUBSCRIBED) but the feed has NOT reported live: we must still be polling
    expect(c.polling).toBe(true);
    // commit lands in the gap: no Realtime event will ever arrive for it
    await repo.submit('hh', { type: 'add_item', commandId: 'g1', actor: 'bob', at: '2026-10-19T10:00:00.000Z', itemId: 'gi', displayName: 'Eggs', category: 'Dairy & eggs' });
    h.intervals[0]!(); // the fallback poll alone would already pick it up
    await flush();
    expect(c.getState().view.items.gi).toBeDefined();

    // second scenario: a commit lands after the last poll but before confirmation, then the feed goes live
    await repo.submit('hh', { type: 'add_item', commandId: 'g2', actor: 'bob', at: '2026-10-19T10:00:01.000Z', itemId: 'gj', displayName: 'Flour', category: 'Baking' });
    f.status('live');
    await flush();
    expect(c.polling).toBe(false);
    expect(c.getState().view.items.gj).toBeDefined(); // catch-up #1 after confirmation
    // a third commit during the confirmation round-trip is closed by catch-up #2
    await repo.submit('hh', { type: 'add_item', commandId: 'g3', actor: 'bob', at: '2026-10-19T10:00:02.000Z', itemId: 'gk', displayName: 'Salt', category: 'Baking' });
    expect(h.timeouts).toHaveLength(1);
    h.timeouts.shift()!();
    await flush();
    expect(c.getState().view.items.gk).toBeDefined();
    const ids = Object.keys(c.getState().view.items);
    expect(ids.filter((i) => i === 'gi' || i === 'gj' || i === 'gk')).toHaveLength(3);
    // replaying the same log again changes nothing (cursor/idempotency)
    const cursor = c.getState().client.cursor;
    await c.sync();
    await c.sync();
    expect(c.getState().client.cursor).toBe(cursor);
    expect(Object.keys(c.getState().view.items)).toEqual(ids);
    c.stop();
    expect(h.timeouts).toHaveLength(0);
  });

  it('dropping out of live cancels the pending second catch-up and resumes polling; the next confirmation does it all again', async () => {
    const repo = new InMemoryShoppingRepository();
    const f = manualFeed();
    const h = controllerFor(repo, f.feed);
    const c = await h.make();
    c.start();
    f.status('live');
    expect(h.timeouts).toHaveLength(1);
    f.status('down');
    expect(h.timeouts).toHaveLength(0);
    expect(c.polling).toBe(true);
    const before = h.syncs();
    f.status('live');
    await flush();
    expect(h.syncs()).toBe(before + 1);
    expect(h.timeouts).toHaveLength(1);
    c.stop();
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
