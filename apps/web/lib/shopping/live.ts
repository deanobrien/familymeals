// Live updates for the shared shopping list (lane S2, D122). Client-safe, framework-free.
//
// Supabase Realtime is a HINT, never the data: an INSERT on shopping_command_log for the household (postgres_changes,
// filtered by RLS for the signed-in member) makes the controller run its normal sync, which fetches the log after its
// cursor from the server. So a missed, duplicated or reordered event can never corrupt state; it only delays an update
// until the next event, reconnect, focus or the fallback poll.
//
// RT1 (D200-D203): 'live' means the server CONFIRMED the postgres_changes listener (the realtime `system` message
// with extension postgres_changes / status ok), not merely that the channel joined (SUBSCRIBED). Until then the
// controller keeps polling, and on every confirmation it catches up from its cursor (twice, to close the race).

/** Feed status: 'live' = listener confirmed; 'down' = not (yet) confirmed or dropped -> the controller polls meanwhile. */
export type LiveStatus = 'live' | 'down';

export interface LiveFeed {
  /** Start listening. `onChange(seq)` gets the per-list sequence of the new log row when known (undefined = "catch up"). Returns stop. */
  start(onChange: (seq?: number) => void, onStatus: (s: LiveStatus) => void): () => void;
}

/** The slice of a supabase-js RealtimeChannel this feed uses (so tests can pass a fake). */
export interface ChannelLike {
  on(
    type: 'postgres_changes',
    filter: { event: 'INSERT'; schema: string; table: string; filter?: string },
    cb: (payload: { new?: Record<string, unknown> }) => void,
  ): ChannelLike;
  on(type: 'system', filter: Record<string, never>, cb: (msg: { extension?: string; status?: string; message?: string }) => void): ChannelLike;
  subscribe(cb?: (status: string, err?: Error) => void): ChannelLike;
}

export interface RealtimeClientLike {
  channel(name: string): ChannelLike;
  removeChannel(ch: ChannelLike): unknown;
  /** supabase-js: pushes a (refreshed) JWT to the realtime socket and joined channels. */
  realtime?: { setAuth(token?: string | null): unknown };
  auth?: {
    onAuthStateChange(
      cb: (event: string, session: { access_token?: string } | null) => void,
    ): { data: { subscription: { unsubscribe(): void } } };
  };
}

export interface SupabaseFeedOptions {
  /** Delay before re-subscribing after CHANNEL_ERROR / TIMED_OUT / CLOSED; grows x2 up to maxRetryMs. */
  retryMs?: number;
  maxRetryMs?: number;
  /** SUBSCRIBED but no postgres_changes confirmation within this long: tear down and retry (default 10 s). */
  confirmMs?: number;
  /** While live: a catch-up hint every heartbeatMs (default 30 s); a gap >2.5x means the tab slept -> reconnect. */
  heartbeatMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  /** Window-ish event source: 'online' / 'visible' (tab shown). Defaults to window + document. */
  environment?: { on(event: 'online' | 'visible', fn: () => void): () => void };
}

function browserEnvironment(): SupabaseFeedOptions['environment'] {
  if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;
  return {
    on(event, fn) {
      if (event === 'online') {
        window.addEventListener('online', fn);
        return () => window.removeEventListener('online', fn);
      }
      const h = () => { if (!document.hidden) fn(); };
      document.addEventListener('visibilitychange', h);
      return () => document.removeEventListener('visibilitychange', h);
    },
  };
}

/**
 * Realtime subscription to the household's shopping command log. Reports 'live' only once the server confirmed the
 * postgres_changes listener. Re-subscribes with backoff on error / timeout / close / missing confirmation, forces a
 * reconnect after tab sleep or when the browser comes back online, and pushes refreshed JWTs to the socket.
 */
export function createSupabaseLiveFeed(client: RealtimeClientLike, householdId: string, opts: SupabaseFeedOptions = {}): LiveFeed {
  const base = opts.retryMs ?? 2000;
  const max = opts.maxRetryMs ?? 30_000;
  const confirmMs = opts.confirmMs ?? 10_000;
  const heartbeatMs = opts.heartbeatMs ?? 30_000;
  const now = opts.now ?? (() => Date.now());
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const environment = opts.environment ?? browserEnvironment();
  return {
    start(onChange, onStatus) {
      let stopped = false;
      let channel: ChannelLike | undefined;
      let retryTimer: unknown;
      let confirmTimer: unknown;
      let beatTimer: unknown;
      let lastBeat = now();
      let delay = base;
      let generation = 0;
      let live = false;
      const cleanups: Array<() => void> = [];

      const setLive = (next: boolean) => {
        if (live === next) return;
        live = next;
        onStatus(next ? 'live' : 'down');
      };
      const clearConfirm = () => {
        if (confirmTimer !== undefined) clearTimer(confirmTimer);
        confirmTimer = undefined;
      };
      const drop = () => {
        clearConfirm();
        if (channel) {
          try { client.removeChannel(channel); } catch { /* already gone */ }
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
      /** Something went wrong: not live (the controller polls), tear down, retry with backoff. */
      const failed = () => {
        setLive(false);
        drop();
        retry();
      };
      /** Reconnect right now (online / tab resumed / slept), skipping the backoff. */
      const reconnectNow = () => {
        if (stopped) return;
        if (retryTimer !== undefined) { clearTimer(retryTimer); retryTimer = undefined; }
        delay = base;
        setLive(false);
        connect();
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
          // SUBSCRIBED only means the channel joined; the server confirms the postgres_changes listener separately,
          // slightly later. A commit in between is delivered to nobody, so only this message makes us live (D200).
          .on('system', {}, (msg) => {
            if (stopped || gen !== generation || msg.extension !== 'postgres_changes') return;
            if (msg.status === 'ok') {
              clearConfirm();
              delay = base;
              setLive(true);
            } else {
              failed();
            }
          })
          .subscribe((status) => {
            if (stopped || gen !== generation) return;
            if (status === 'SUBSCRIBED') {
              if (!live && confirmTimer === undefined) {
                confirmTimer = setTimer(() => { confirmTimer = undefined; if (gen === generation) failed(); }, confirmMs);
              }
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
              failed();
            }
          });
      };
      const beat = () => {
        beatTimer = setTimer(() => {
          const t = now();
          const gap = t - lastBeat;
          lastBeat = t;
          if (stopped) return;
          if (gap > heartbeatMs * 2.5) reconnectNow(); // the tab/laptop slept: the socket is probably dead
          else if (live) onChange(undefined); // heartbeat catch-up
          beat();
        }, heartbeatMs);
      };

      onStatus('down');
      connect();
      beat();
      if (environment) {
        cleanups.push(
          environment.on('online', () => {
            lastBeat = now();
            if (live) onChange(undefined);
            else reconnectNow();
          }),
          environment.on('visible', () => {
            const slept = now() - lastBeat > heartbeatMs * 2.5;
            lastBeat = now();
            if (!live || slept) reconnectNow();
            else onChange(undefined);
          }),
        );
      }
      // Session renewal: hand the fresh JWT to the realtime socket (RLS is evaluated per event with it) and catch up.
      if (client.auth) {
        try {
          const { data } = client.auth.onAuthStateChange((event, session) => {
            if (stopped || !session?.access_token) return;
            if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
              try { client.realtime?.setAuth(session.access_token); } catch { /* socket gone: the retry path reconnects */ }
              onChange(undefined);
            }
          });
          cleanups.push(() => data.subscription.unsubscribe());
        } catch { /* no auth client: supabase-js still refreshes the socket itself */ }
      }
      return () => {
        stopped = true;
        if (retryTimer !== undefined) clearTimer(retryTimer);
        if (beatTimer !== undefined) clearTimer(beatTimer);
        retryTimer = undefined;
        beatTimer = undefined;
        for (const c of cleanups) c();
        drop();
      };
    },
  };
}
