import { createShoppingLiveFeed, type ChannelLike, type RealtimeClientLike, type LiveStatus } from '@/data/liveFeed';

/** A scriptable channel: the test decides when SUBSCRIBED / system ok / inserts arrive. */
function fakeClient() {
  const channels: Array<{
    name: string;
    insert?: (p: { new?: Record<string, unknown> }) => void;
    system?: (p: { status?: string }) => void;
    status?: (s: string) => void;
    removed: boolean;
    ch?: unknown;
  }> = [];
  const client: RealtimeClientLike = {
    channel(name) {
      const c: (typeof channels)[number] = { name, removed: false };
      channels.push(c);
      const ch = {
        on(type: string, _f: unknown, cb: never) {
          if (type === 'postgres_changes') c.insert = cb;
          else c.system = cb;
          return ch;
        },
        subscribe(cb?: (s: string) => void) {
          c.status = cb;
          return ch;
        },
      };
      c.ch = ch;
      return ch as unknown as ChannelLike;
    },
    removeChannel(ch) {
      const c = channels.find((x) => x.ch === ch);
      if (c) c.removed = true;
      return undefined;
    },
  };
  return { client, channels };
}

function timers() {
  const pending: Array<{ fn: () => void; ms: number; id: number; live: boolean }> = [];
  let id = 0;
  return {
    pending,
    setTimer: (fn: () => void, ms: number) => {
      const t = { fn, ms, id: ++id, live: true };
      pending.push(t);
      return t.id;
    },
    clearTimer: (h: unknown) => {
      const t = pending.find((x) => x.id === h);
      if (t) t.live = false;
    },
    fire: (ms: number) => pending.filter((t) => t.live && t.ms === ms).forEach((t) => ((t.live = false), t.fn())),
    liveMs: () => pending.filter((t) => t.live).map((t) => t.ms),
  };
}

describe('createShoppingLiveFeed', () => {
  it('reports live only after the server confirms the listener, whichever order the messages arrive', () => {
    const { client, channels } = fakeClient();
    const t = timers();
    const statuses: LiveStatus[] = [];
    createShoppingLiveFeed(client, 'hh', { setTimer: t.setTimer, clearTimer: t.clearTimer }).start(() => undefined, (s) => statuses.push(s));
    expect(statuses).toEqual(['down']);

    channels[0]!.status!('SUBSCRIBED');
    expect(statuses).toEqual(['down']); // subscribed but not confirmed
    channels[0]!.system!({ status: 'ok' });
    expect(statuses).toEqual(['down', 'live']);
    channels[0]!.system!({ status: 'ok' });
    expect(statuses).toEqual(['down', 'live']); // once

    // Confirmation first, SUBSCRIBED second (fresh channel after a retry).
    channels[0]!.status!('CLOSED');
    expect(statuses).toEqual(['down', 'live', 'down']);
    t.fire(2000);
    expect(channels).toHaveLength(2);
    channels[1]!.system!({ status: 'ok' });
    expect(statuses).toHaveLength(3);
    channels[1]!.status!('SUBSCRIBED');
    expect(statuses).toEqual(['down', 'live', 'down', 'live']);
  });

  it('falls back to live after the confirmation timeout when the server never confirms', () => {
    const { client, channels } = fakeClient();
    const t = timers();
    const statuses: LiveStatus[] = [];
    createShoppingLiveFeed(client, 'hh', { confirmTimeoutMs: 5000, setTimer: t.setTimer, clearTimer: t.clearTimer }).start(() => undefined, (s) => statuses.push(s));
    channels[0]!.status!('SUBSCRIBED');
    expect(statuses).toEqual(['down']);
    t.fire(5000);
    expect(statuses).toEqual(['down', 'live']);
  });

  it('passes the per-list sequence of inserts and ignores events from a stale channel generation', () => {
    const { client, channels } = fakeClient();
    const t = timers();
    const seqs: Array<number | undefined> = [];
    createShoppingLiveFeed(client, 'hh', { setTimer: t.setTimer, clearTimer: t.clearTimer }).start((s) => seqs.push(s), () => undefined);
    channels[0]!.insert!({ new: { list_seq: 7 } });
    channels[0]!.insert!({ new: {} });
    expect(seqs).toEqual([7, undefined]);
    channels[0]!.status!('CHANNEL_ERROR');
    t.fire(2000);
    channels[0]!.insert!({ new: { list_seq: 8 } }); // old generation: dropped
    channels[1]!.insert!({ new: { list_seq: 9 } });
    expect(seqs).toEqual([7, undefined, 9]);
  });

  it('backs off exponentially and stops cleanly', () => {
    const { client, channels } = fakeClient();
    const t = timers();
    const statuses: LiveStatus[] = [];
    const stop = createShoppingLiveFeed(client, 'hh', { maxRetryMs: 6000, setTimer: t.setTimer, clearTimer: t.clearTimer }).start(() => undefined, (s) => statuses.push(s));
    channels[0]!.status!('TIMED_OUT');
    expect(t.liveMs()).toEqual([2000]);
    t.fire(2000);
    channels[1]!.status!('TIMED_OUT');
    expect(t.liveMs()).toEqual([4000]);
    t.fire(4000);
    channels[2]!.status!('TIMED_OUT');
    expect(t.liveMs()).toEqual([6000]); // capped
    stop();
    expect(t.liveMs()).toEqual([]);
    channels[2]!.status!('SUBSCRIBED');
    expect(statuses.filter((s) => s === 'live')).toHaveLength(0);
  });
});
