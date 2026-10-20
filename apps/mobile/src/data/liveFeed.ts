/**
 * Realtime hint feed for the shared shopping list (D211). Same approach as the web (`apps/web/lib/shopping/live.ts`):
 * an INSERT on `shopping_command_log` for the household only tells the app "something changed, catch up from your
 * cursor"; the data is always read back through the snapshot / log queries, so a missed, duplicated or reordered
 * event cannot corrupt state.
 *
 * Difference from the web feed (closes web D149 finding 1): 'live' is reported only once the SERVER has confirmed the
 * `postgres_changes` listener (a `system` message with status ok), not merely when the channel is SUBSCRIBED. The
 * caller does a catch-up on 'live', so a change committed between SUBSCRIBED and the confirmation is never missed. If
 * the confirmation never arrives (older server), 'live' is reported after `confirmTimeoutMs` anyway.
 */

/** 'live' = subscribed AND confirmed; 'down' = not (yet) subscribed or dropped -> the caller polls meanwhile. */
export type LiveStatus = 'live' | 'down';

export interface LiveFeed {
  /** Start listening. `onChange(seq)` gets the per-list sequence of the new log row when known. Returns stop. */
  start(onChange: (seq?: number) => void, onStatus: (s: LiveStatus) => void): () => void;
}

export interface ChannelLike {
  on(
    type: 'postgres_changes',
    filter: { event: 'INSERT'; schema: string; table: string; filter?: string },
    cb: (payload: { new?: Record<string, unknown> }) => void,
  ): ChannelLike;
  on(type: 'system', filter: Record<string, never>, cb: (payload: { extension?: string; status?: string }) => void): ChannelLike;
  subscribe(cb?: (status: string, err?: Error) => void): ChannelLike;
}

export interface RealtimeClientLike {
  channel(name: string): ChannelLike;
  removeChannel(ch: ChannelLike): unknown;
}

export interface LiveFeedOptions {
  /** Delay before re-subscribing after CHANNEL_ERROR / TIMED_OUT / CLOSED; doubles up to maxRetryMs. */
  retryMs?: number;
  maxRetryMs?: number;
  /** Wait this long for the server's confirmation after SUBSCRIBED before reporting 'live' anyway. */
  confirmTimeoutMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

export function createShoppingLiveFeed(client: RealtimeClientLike, householdId: string, opts: LiveFeedOptions = {}): LiveFeed {
  const base = opts.retryMs ?? 2000;
  const max = opts.maxRetryMs ?? 30_000;
  const confirmMs = opts.confirmTimeoutMs ?? 5000;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  return {
    start(onChange, onStatus) {
      let stopped = false;
      let channel: ChannelLike | undefined;
      let retryTimer: unknown;
      let confirmTimer: unknown;
      let delay = base;
      let generation = 0;

      const clearConfirm = () => {
        if (confirmTimer !== undefined) clearTimer(confirmTimer);
        confirmTimer = undefined;
      };
      const drop = () => {
        clearConfirm();
        if (channel) {
          try {
            client.removeChannel(channel);
          } catch {
            /* already gone */
          }
          channel = undefined;
        }
      };
      const retry = () => {
        if (stopped || retryTimer !== undefined) return;
        retryTimer = setTimer(() => {
          retryTimer = undefined;
          connect();
        }, delay);
        delay = Math.min(delay * 2, max);
      };
      const connect = () => {
        if (stopped) return;
        drop();
        const gen = ++generation;
        let subscribed = false;
        let live = false;
        let confirmed = false;
        const goLive = () => {
          if (stopped || gen !== generation || live || !subscribed) return;
          live = true;
          clearConfirm();
          delay = base;
          onStatus('live');
        };
        channel = client
          .channel(`shopping-log:${householdId}:${gen}`)
          .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'shopping_command_log', filter: `household_id=eq.${householdId}` },
            (payload) => {
              if (stopped || gen !== generation) return;
              const seq = Number(payload.new?.list_seq);
              onChange(Number.isFinite(seq) ? seq : undefined);
            },
          )
          .on('system', {}, (payload) => {
            // The server confirms the postgres_changes listener (or replication readiness) with status ok.
            if (payload?.status === 'ok') {
              confirmed = true;
              goLive();
            }
          })
          .subscribe((status) => {
            if (stopped || gen !== generation) return;
            if (status === 'SUBSCRIBED') {
              subscribed = true;
              if (confirmed) goLive();
              else if (confirmTimer === undefined) confirmTimer = setTimer(goLive, confirmMs);
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
              subscribed = false;
              live = false;
              clearConfirm();
              onStatus('down');
              retry();
            }
          });
      };

      onStatus('down');
      connect();
      return () => {
        stopped = true;
        if (retryTimer !== undefined) clearTimer(retryTimer);
        retryTimer = undefined;
        drop();
      };
    },
  };
}
