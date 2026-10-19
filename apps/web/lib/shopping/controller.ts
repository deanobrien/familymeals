import type {
  ClientState, Command, CommandResult, Quantity, ShoppingState, Uuid,
} from './engine';
import {
  clientEnqueue, clientIngest, clientResync, clientTakeConflicts, clientView, createClient,
  defaultEngineContext,
} from './engine';
import type { ListMeta, SnapshotDto, SyncResponse } from './types';

/** Server round trips (server actions in the app; fakes in tests). */
export interface Transport {
  sync(commands: Command[], cursor: number): Promise<SyncResponse>;
  snapshot(): Promise<SnapshotDto>;
}

/** Durable pending queue (localStorage in the browser). Must never throw. */
export interface PendingStore {
  load(): Command[];
  save(pending: Command[]): void;
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
}

export interface ControllerDeps {
  transport: Transport;
  store: PendingStore;
  /** Signed-in member id (from the server's household context); the server overrides it anyway. */
  actor: () => Uuid;
  newId: () => Uuid;
  now?: () => string;
  onNotice?: (n: Notice) => void;
}

/** Placeholder for Supabase Realtime: poll the command log. TODO: subscribe to shopping_command_log inserts. */
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
  private timer: ReturnType<typeof setInterval> | undefined;
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
    return { client, view, meta, status, pendingItemIds, pendingCount: client.pending.length };
  }

  private set(client: ClientState, meta = this.state.meta, status = this.state.status): void {
    this.state = this.derive(client, meta, status);
    this.deps.store.save(client.pending);
    for (const l of this.listeners) l();
  }

  /** Re-queue commands persisted by a previous session. Deliberately not in the constructor (hydration). */
  restore(): void {
    let client = this.state.client;
    for (const c of this.deps.store.load()) client = clientEnqueue(client, c);
    if (client !== this.state.client) this.set(client);
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
        const res = await this.deps.transport.sync(sent.pending, sent.cursor);
        this.ingest(res);
        if (this.state.client.needsResync) {
          const snap = await this.deps.transport.snapshot();
          this.set(
            clientResync(this.state.client, { cursor: snap.cursor, state: snap.state }, [], defaultEngineContext),
            snap.meta, 'synced',
          );
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
    for (const r of conflicts) {
      // Undo of an event that never became a purchase (our own tick lost the race) is noise.
      if (r.type === 'undo' && r.reason === 'event_not_found') continue;
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
    this.restore();
    void this.sync(); // replays anything persisted from a previous session
    this.timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      void this.sync();
    }, POLL_MS);
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

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
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
