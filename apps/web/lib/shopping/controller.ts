import type {
  ClientState, Command, CommandResult, Quantity, ShoppingState, Uuid,
} from './engine';
import {
  clientEnqueue, clientIngest, clientResync, clientTakeConflicts, clientView, createClient,
  defaultEngineContext,
} from './engine';
import type { LiveFeed, LiveStatus } from './live';
import type { ListMeta, SnapshotDto, SyncResponse } from './types';

/** Server round trips (server actions in the app; fakes in tests). */
export interface Transport {
  /** `listId` = the list this client is showing (D263): the server refuses to mix it up with another list. */
  sync(commands: Command[], cursor: number, listId?: string): Promise<SyncResponse>;
  snapshot(): Promise<SnapshotDto>;
}

/**
 * Durable pending queue. Must never throw. localStorage is synchronous; the offline PWA (P3-C, D446) uses IndexedDB, which is
 * not, so `load` may return a promise and `save` may be asynchronous (writes are fire-and-forget, serialised by the store).
 */
export interface PendingStore {
  load(): Command[] | Promise<Command[]>;
  save(pending: Command[]): void | Promise<void>;
}

/** Last confirmed server state of the list, kept on the device so a reload with no signal can still show it (P3-C, D446). */
export interface CachedList {
  cursor: number;
  state: ShoppingState;
  meta: ListMeta;
}
export interface SnapshotCache {
  load(): Promise<CachedList | null>;
  save(list: CachedList): void | Promise<void>;
}

export type SyncStatus = 'synced' | 'syncing' | 'offline';

export interface Notice {
  kind: 'conflict' | 'rejected' | 'dropped';
  result?: CommandResult;
  itemName?: string;
}

export interface ControllerState {
  client: ClientState;
  /** Optimistic view: pending commands replayed over the confirmed server state. */
  view: ShoppingState;
  meta: ListMeta;
  status: SyncStatus;
  /** Items (and undo targets) with a local change the server has not confirmed yet. */
  pendingItemIds: ReadonlySet<Uuid>;
  pendingCount: number;
  /** Realtime listener confirmed by the server (RT1); false while polling. */
  live: boolean;
}

export interface ControllerDeps {
  transport: Transport;
  store: PendingStore;
  /** Optional on-device copy of the last confirmed list (offline PWA). */
  snapshots?: SnapshotCache;
  /** Signed-in member id (from the server's household context); the server overrides it anyway. */
  actor: () => Uuid;
  newId: () => Uuid;
  now?: () => string;
  onNotice?: (n: Notice) => void;
  /** Supabase Realtime hint feed (D122). Absent (mock mode): poll every POLL_MS. Present: poll only while it is down. */
  live?: LiveFeed;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (h: unknown) => void;
  /** One-shot timers for the second post-subscribe catch-up (tests inject fakes). */
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (h: unknown) => void;
}

/** Second catch-up after the listener is confirmed: closes the race with a commit that landed during confirmation (D201). */
export const CATCHUP_AGAIN_MS = 1500;

/** Poll interval: always in mock mode; with Realtime only while the channel is down (fallback). */
export const POLL_MS = 4000;

/**
 * Client-side controller around the L17a offline client model:
 * optimistic dispatch -> durable pending queue -> idempotent replay -> ingest server log -> conflicts.
 * Framework-free so it can be driven by tests and by a React hook (useSyncExternalStore).
 */
export class ShoppingController {
  private state: ControllerState;
  private listeners = new Set<() => void>();
  private running: Promise<void> | undefined;
  private again = false;
  private timer: unknown;
  private catchupTimer: unknown;
  private liveStatus: LiveStatus | 'none' = 'none';
  private readonly now: () => string;
  private cleanup: Array<() => void> = [];

  constructor(initial: SnapshotDto, private readonly deps: ControllerDeps) {
    this.now = deps.now ?? (() => new Date().toISOString());
    this.state = this.derive(createClient({ cursor: initial.cursor, state: initial.state }), initial.meta, 'synced');
  }

  // ---- external store plumbing ----
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = (): ControllerState => this.state;

  private derive(client: ClientState, meta: ListMeta, status: SyncStatus): ControllerState {
    const view = clientView(client, defaultEngineContext);
    const pendingItemIds = new Set<Uuid>();
    for (const c of client.pending) {
      if ('itemId' in c) pendingItemIds.add(c.itemId);
      else if (c.type === 'undo') {
        const e = view.events[c.eventId];
        if (e) pendingItemIds.add(e.shoppingListItemId);
      }
    }
    return { client, view, meta, status, pendingItemIds, pendingCount: client.pending.length, live: this.liveStatus === 'live' };
  }

  private set(client: ClientState, meta = this.state.meta, status = this.state.status): void {
    this.state = this.derive(client, meta, status);
    try {
      const r = this.deps.store.save(client.pending);
      if (r) void r.catch(() => undefined);
    } catch {
      /* the queue lives in memory until storage works again */
    }
    for (const l of this.listeners) l();
  }

  /** Re-queue commands persisted by a previous session. Deliberately not in the constructor (hydration). */
  restore(): void | Promise<void> {
    const loaded = this.deps.store.load();
    if (Array.isArray(loaded)) return this.applyRestored(loaded);
    return loaded.then((c) => this.applyRestored(c), () => undefined);
  }

  private applyRestored(commands: Command[]): void {
    let client = this.state.client;
    for (const c of commands) client = clientEnqueue(client, c);
    if (client !== this.state.client) this.set(client);
  }

  /**
   * The page may have come from the service worker's cache and be older than what this device last confirmed (the list moved on
   * while the page stayed cached): adopt the newer on-device copy when it is the SAME list and ahead of the cursor we have.
   * Queued commands are kept and replayed over it by the engine. Never goes backwards.
   */
  private async adoptCached(): Promise<void> {
    const snaps = this.deps.snapshots;
    if (!snaps) return;
    try {
      const cached = await snaps.load();
      const cur = this.state.client;
      // A page rendered before the household had a list knows no list id: the on-device list is then the newer picture.
      const pageHadNoList = !this.state.meta.listId && !!cached?.meta.listId;
      const sameList = (cached?.meta.listId ?? null) === (this.state.meta.listId ?? null);
      if (!cached || (!pageHadNoList && (!sameList || cached.cursor <= cur.cursor))) {
        this.saveSnapshot(); // what the page was rendered with is at least as new: keep it for the next offline reload
        return;
      }
      this.set(clientResync(cur, { cursor: cached.cursor, state: cached.state }, [], defaultEngineContext), cached.meta);
    } catch {
      /* a bad cache entry must never block the list */
    }
  }

  private saveSnapshot(): void {
    const snaps = this.deps.snapshots;
    if (!snaps) return;
    const c = this.state.client;
    try {
      const r = snaps.save({ cursor: c.cursor, state: c.confirmed, meta: this.state.meta });
      if (r) void r.catch(() => undefined);
    } catch {
      /* cache only */
    }
  }

  // ---- commands ----
  private base() {
    return { commandId: this.deps.newId(), actor: this.deps.actor(), at: this.now() };
  }

  private enqueue(cmd: Command): void {
    this.set(clientEnqueue(this.state.client, cmd));
    void this.sync();
  }

  /** One-tap "I have the rest". Returns the purchase event id (= command id) for the undo toast. */
  tick(itemId: Uuid): Uuid {
    const b = this.base();
    this.enqueue({ ...b, type: 'tick', itemId });
    return b.commandId;
  }

  purchase(itemId: Uuid, quantity: Quantity, actualPricePence?: number): Uuid {
    const b = this.base();
    this.enqueue({
      ...b, type: 'purchase', itemId, quantity,
      ...(actualPricePence !== undefined ? { actualPricePence } : {}),
    });
    return b.commandId;
  }

  undo(eventId: Uuid): void {
    this.enqueue({ ...this.base(), type: 'undo', eventId });
  }

  addItem(f: {
    displayName: string; category: string; quantity?: Quantity; notes?: string; aisle?: string;
  }): Uuid {
    const itemId = this.deps.newId();
    this.enqueue({
      ...this.base(), type: 'add_item', itemId, displayName: f.displayName, category: f.category,
      ...(f.quantity ? { quantity: f.quantity } : {}),
      ...(f.notes ? { notes: f.notes } : {}),
      ...(f.aisle ? { aisle: f.aisle } : {}),
    });
    return itemId;
  }

  editItem(
    itemId: Uuid,
    patch: Extract<Command, { type: 'edit_item' }>['patch'],
  ): void {
    this.enqueue({ ...this.base(), type: 'edit_item', itemId, patch });
  }

  removeItem(itemId: Uuid): void {
    this.enqueue({ ...this.base(), type: 'remove_item', itemId });
  }

  // ---- sync ----
  /** Replay pending commands and catch up with the server log. Serialised; safe to call any time. */
  sync(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.runSync().finally(() => { this.running = undefined; });
    return this.running;
  }

  private async runSync(): Promise<void> {
    try {
      do {
        this.again = false;
        if (this.state.client.pending.length > 0 && this.state.status !== 'syncing') {
          this.set(this.state.client, undefined, 'syncing');
        }
        const sent = this.state.client;
        const res = await this.deps.transport.sync(sent.pending, sent.cursor, this.state.meta.listId);
        this.ingest(res);
        if (this.state.client.needsResync) {
          const snap = await this.deps.transport.snapshot();
          this.set(
            clientResync(this.state.client, { cursor: snap.cursor, state: snap.state }, [], defaultEngineContext),
            snap.meta, 'synced',
          );
          this.saveSnapshot();
        }
      } while (this.again);
    } catch {
      this.set(this.state.client, undefined, 'offline');
    }
  }

  private ingest(res: SyncResponse): void {
    let c = this.state.client;
    if (res.dropped.length > 0) {
      const drop = new Set(res.dropped);
      c = { ...c, pending: c.pending.filter((p) => !drop.has(p.commandId)) };
      this.deps.onNotice?.({ kind: 'dropped' });
    }
    c = res.snapshot
      ? clientResync(c, { cursor: res.snapshot.cursor, state: res.snapshot.state }, res.entries, defaultEngineContext)
      : clientIngest(c, res.entries, defaultEngineContext);
    const [next, conflicts] = clientTakeConflicts(c);
    this.set(next, res.snapshot?.meta ?? res.meta, 'synced');
    this.saveSnapshot();
    for (const r of conflicts) {
      // Undo of an event that never became a purchase (our own tick lost the race) is noise.
      if (r.type === 'undo' && r.reason === 'event_not_found') continue;
      // The server retried this tick under a derived id (Supabase lock-time re-check, D121): bookkeeping, not a conflict.
      if (r.reason === 'superseded') continue;
      const name = r.itemId ? this.state.client.confirmed.items[r.itemId]?.displayName : undefined;
      this.deps.onNotice?.({
        kind: r.reason === 'already_complete' ? 'conflict' : 'rejected', result: r,
        ...(name ? { itemName: name } : {}),
      });
    }
  }

  // ---- lifecycle (browser) ----
  /** Start polling + reconnect handling. Returns a stop function. */
  start(): () => void {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) this.set(this.state.client, undefined, 'offline');
    const restored = this.restore();
    const begin = () => this.adoptCached().then(() => this.sync());
    // Replays anything persisted from a previous session. A synchronous store keeps the old, synchronous start.
    if (restored) void restored.then(begin);
    else if (this.deps.snapshots) void begin();
    else void this.sync();
    if (this.deps.live) {
      const stopLive = this.deps.live.start(
        (seq) => {
          // Our own echo, or something we already have: nothing to fetch.
          if (seq !== undefined && seq <= this.state.client.cursor && this.state.client.pending.length === 0) return;
          void this.sync();
        },
        (status) => this.onLiveStatus(status),
      );
      this.cleanup.push(stopLive);
    } else {
      this.startPolling();
    }
    if (typeof window !== 'undefined') {
      const online = () => void this.sync();
      const offline = () => this.set(this.state.client, undefined, 'offline');
      const visible = () => { if (!document.hidden) void this.sync(); };
      window.addEventListener('online', online);
      window.addEventListener('offline', offline);
      document.addEventListener('visibilitychange', visible);
      this.cleanup.push(
        () => window.removeEventListener('online', online),
        () => window.removeEventListener('offline', offline),
        () => document.removeEventListener('visibilitychange', visible),
      );
    }
    return () => this.stop();
  }

  /** Realtime up: stop polling and catch up from the cursor (events missed while down). Down: poll until it is back. */
  private onLiveStatus(status: LiveStatus): void {
    const was = this.liveStatus;
    this.liveStatus = status;
    if ((was === 'live') !== (status === 'live')) this.set(this.state.client); // re-derive: state.live
    if (status === 'live') {
      // Listener confirmed by the server. Anything committed before that moment was never pushed to us: fetch it from
      // the cursor now, and once more shortly after (D201). Keep polling until this point, never before.
      this.stopPolling();
      if (was !== 'live') {
        void this.sync();
        this.clearCatchup();
        this.catchupTimer = (this.deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms)))(() => {
          this.catchupTimer = undefined;
          void this.sync();
        }, CATCHUP_AGAIN_MS);
      }
    } else {
      this.clearCatchup();
      this.startPolling();
    }
  }

  /** For tests / diagnostics: is the fallback poll running? */
  get polling(): boolean {
    return this.timer !== undefined;
  }

  private startPolling(): void {
    if (this.timer !== undefined) return;
    const every = this.deps.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
    this.timer = every(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      void this.sync();
    }, POLL_MS);
  }

  private stopPolling(): void {
    if (this.timer === undefined) return;
    (this.deps.clearInterval ?? ((h: unknown) => clearInterval(h as ReturnType<typeof setInterval>)))(this.timer);
    this.timer = undefined;
  }

  private clearCatchup(): void {
    if (this.catchupTimer === undefined) return;
    (this.deps.clearTimeout ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.catchupTimer);
    this.catchupTimer = undefined;
  }

  stop(): void {
    this.stopPolling();
    this.clearCatchup();
    this.liveStatus = 'none';
    for (const c of this.cleanup) c();
    this.cleanup = [];
  }
}

/** localStorage-backed pending queue; every access guarded (private mode / blocked storage). */
export function localStoragePendingStore(key: string): PendingStore {
  return {
    load() {
      try {
        const raw = window.localStorage.getItem(key);
        const v: unknown = raw ? JSON.parse(raw) : [];
        return Array.isArray(v) ? (v as Command[]) : [];
      } catch {
        return [];
      }
    },
    save(pending) {
      try {
        if (pending.length === 0) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, JSON.stringify(pending));
      } catch {
        /* storage unavailable: queue lives in memory only */
      }
    },
  };
}

export function newUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Non-secure-context fallback (tests / odd embeds).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
