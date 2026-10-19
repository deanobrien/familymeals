// Live updates for the shared shopping list (lane S2, D122). Client-safe, framework-free.
//
// Supabase Realtime is a HINT, never the data: an INSERT on shopping_command_log for the household (postgres_changes,
// filtered by RLS for the signed-in member) makes the controller run its normal sync, which fetches the log after its
// cursor from the server. So a missed, duplicated or reordered event can never corrupt state; it only delays an update
// until the next event, reconnect, focus or the fallback poll.

/** Feed status: 'live' = subscribed; 'down' = not (yet) subscribed or dropped -> the controller polls meanwhile. */
export type LiveStatus = 'live' | 'down';

export interface LiveFeed {
  /** Start listening. `onChange(seq)` gets the per-list sequence of the new log row when known. Returns stop. */
  start(onChange: (seq?: number) => void, onStatus: (s: LiveStatus) => void): () => void;
}

/** The slice of a supabase-js RealtimeChannel this feed uses (so tests can pass a fake). */
export interface ChannelLike {
  on(
    type: 'postgres_changes',
    filter: { event: 'INSERT'; schema: string; table: string; filter?: string },
    cb: (payload: { new?: Record<string, unknown> }) => void,
  ): ChannelLike;
  subscribe(cb?: (status: string, err?: Error) => void): ChannelLike;
}

export interface RealtimeClientLike {
  channel(name: string): ChannelLike;
  removeChannel(ch: ChannelLike): unknown;
}

export interface SupabaseFeedOptions {
  /** Delay before re-subscribing after CHANNEL_ERROR / TIMED_OUT / CLOSED; grows x2 up to maxRetryMs. */
  retryMs?: number;
  maxRetryMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

/**
 * Realtime subscription to the household's shopping command log. Re-subscribes with backoff when the channel errors,
 * times out or closes; every (re)subscription reports 'live', which makes the controller catch up from its cursor.
 */
export function createSupabaseLiveFeed(client: RealtimeClientLike, householdId: string, opts: SupabaseFeedOptions = {}): LiveFeed {
  const base = opts.retryMs ?? 2000;
  const max = opts.maxRetryMs ?? 30_000;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  return {
    start(onChange, onStatus) {
      let stopped = false;
      let channel: ChannelLike | undefined;
      let timer: unknown;
      let delay = base;
      let generation = 0;

      const drop = () => {
        if (channel) {
          try { client.removeChannel(channel); } catch { /* already gone */ }
          channel = undefined;
        }
      };
      const retry = () => {
        if (stopped || timer !== undefined) return;
        timer = setTimer(() => {
          timer = undefined;
          connect();
        }, delay);
        delay = Math.min(delay * 2, max);
      };
      const connect = () => {
        if (stopped) return;
        drop();
        const gen = ++generation;
        channel = client
          .channel(`shopping-log:${householdId}:${gen}`)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'shopping_command_log', filter: `household_id=eq.${householdId}` },
            (payload) => {
              if (stopped || gen !== generation) return;
              const seq = Number(payload.new?.list_seq);
              onChange(Number.isFinite(seq) ? seq : undefined);
            })
          .subscribe((status) => {
            if (stopped || gen !== generation) return;
            if (status === 'SUBSCRIBED') {
              delay = base;
              onStatus('live');
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
              onStatus('down');
              retry();
            }
          });
      };

      onStatus('down');
      connect();
      return () => {
        stopped = true;
        if (timer !== undefined) clearTimer(timer);
        timer = undefined;
        drop();
      };
    },
  };
}
