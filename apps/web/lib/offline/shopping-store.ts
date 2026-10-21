// Offline storage for the web shopping list (P3-C, D446): the SAME engine queue semantics as Android's offline queue
// (apps/mobile/src/data/offlineQueue.ts): commands carry a client-generated id, are kept until the server acknowledges them
// and are replayed in order (a resend is idempotent). Here the queue and the last confirmed snapshot live in IndexedDB, bound to
// the signed-in user so a different person on the same browser never inherits (or replays) someone else's queue.
//
// Several tabs share one database, so a save MERGES: it removes only the commands THIS tab acknowledged and adds its own, in one
// transaction. A tab never deletes a command another tab queued and has not delivered yet.
import type { Command } from '../shopping/engine';
import type { CachedList, PendingStore, SnapshotCache } from '../shopping/controller';
import type { KvStore } from './kv';

export const QUEUE_KEY = 'shopping.queue.v1';
export const SNAPSHOT_KEY = 'shopping.snapshot.v1';
/** The pre-PWA queue (localStorage); migrated once, then removed. */
export const LEGACY_LS_KEY = 'fr.shopping.pending.v1';

const COMMAND_TYPES = new Set(['tick', 'purchase', 'undo', 'add_item', 'edit_item', 'remove_item', 'regenerate']);

export function isCommand(v: unknown): v is Command {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return typeof c.commandId === 'string' && typeof c.type === 'string' && COMMAND_TYPES.has(c.type);
}

interface QueueRecord { v: 1; userId: string; commands: Command[] }
interface SnapshotRecord { v: 1; userId: string; savedAt: string; list: CachedList }

type LegacyStorage = Pick<Storage, 'getItem' | 'removeItem'>;

export class OfflineShoppingStore implements PendingStore, SnapshotCache {
  /** Writes are serialised: a later save never overtakes an earlier one. */
  private chain: Promise<unknown> = Promise.resolve();
  /** Command ids this tab has loaded or saved: the only ones it may remove from the shared queue. */
  private readonly mine = new Set<string>();

  constructor(
    private readonly kv: KvStore | null,
    private readonly userId: string,
    private readonly legacy: LegacyStorage | null = null,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  private enqueueWrite(fn: () => Promise<void>): Promise<void> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  /** Resolves when every write so far has landed (tests, and a clean hand-off before navigating away). */
  whenIdle(): Promise<void> {
    return this.chain.then(() => undefined);
  }

  async load(): Promise<Command[]> {
    const fromLegacy = this.takeLegacy();
    if (!this.kv) return fromLegacy;
    const rec = await this.kv.get<QueueRecord>(QUEUE_KEY);
    if (rec && rec.userId !== this.userId) {
      // Another person's queue: never replayed under this user, never kept.
      await this.kv.del(QUEUE_KEY);
      return this.track(fromLegacy);
    }
    const commands = Array.isArray(rec?.commands) ? rec.commands.filter(isCommand) : [];
    const seen = new Set(commands.map((c) => c.commandId));
    return this.track([...commands, ...fromLegacy.filter((c) => !seen.has(c.commandId))]);
  }

  private track(commands: Command[]): Command[] {
    for (const c of commands) this.mine.add(c.commandId);
    return commands;
  }

  /** One-time move of the old localStorage queue (same command ids, so a replay stays idempotent). */
  private takeLegacy(): Command[] {
    try {
      const raw = this.legacy?.getItem(LEGACY_LS_KEY);
      if (!raw) return [];
      this.legacy?.removeItem(LEGACY_LS_KEY);
      const v: unknown = JSON.parse(raw);
      return Array.isArray(v) ? v.filter(isCommand) : [];
    } catch {
      return [];
    }
  }

  save(pending: Command[]): Promise<void> {
    const kv = this.kv;
    if (!kv) return Promise.resolve();
    const ids = new Set(pending.map((c) => c.commandId));
    const removed = new Set([...this.mine].filter((id) => !ids.has(id)));
    for (const id of removed) this.mine.delete(id);
    for (const id of ids) this.mine.add(id);
    return this.enqueueWrite(() =>
      kv.update<QueueRecord>(QUEUE_KEY, (cur) => {
        const base = cur && cur.userId === this.userId && Array.isArray(cur.commands) ? cur.commands.filter(isCommand) : [];
        const kept = base.filter((c) => !removed.has(c.commandId));
        const have = new Set(kept.map((c) => c.commandId));
        const merged = [...kept, ...pending.filter((c) => !have.has(c.commandId))];
        return merged.length === 0 ? null : { v: 1, userId: this.userId, commands: merged };
      }),
    );
  }

  async loadSnapshot(): Promise<CachedList | null> {
    if (!this.kv) return null;
    const rec = await this.kv.get<SnapshotRecord>(SNAPSHOT_KEY);
    if (!rec || rec.userId !== this.userId || !rec.list || typeof rec.list.cursor !== 'number' || !rec.list.state) return null;
    return rec.list;
  }

  /** Never replaces a newer snapshot of the same list (another tab may be ahead); a different list or user is replaced. */
  saveSnapshot(list: CachedList): Promise<void> {
    const kv = this.kv;
    if (!kv) return Promise.resolve();
    return this.enqueueWrite(() =>
      kv.update<SnapshotRecord>(SNAPSHOT_KEY, (cur) => {
        const ahead = cur && cur.userId === this.userId && (cur.list?.meta?.listId ?? null) === (list.meta.listId ?? null) && cur.list.cursor > list.cursor;
        return ahead ? cur : { v: 1, userId: this.userId, savedAt: this.now(), list };
      }),
    );
  }

  /** The SnapshotCache view of this store. */
  get snapshots(): SnapshotCache {
    return { load: () => this.loadSnapshot(), save: (l) => this.saveSnapshot(l) };
  }

  /** Sign-out: queue and snapshot both gone. */
  clear(): Promise<void> {
    const kv = this.kv;
    if (!kv) return Promise.resolve();
    this.mine.clear();
    return this.enqueueWrite(async () => {
      await kv.del(QUEUE_KEY);
      await kv.del(SNAPSHOT_KEY);
    });
  }
}
