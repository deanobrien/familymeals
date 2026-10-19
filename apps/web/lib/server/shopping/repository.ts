import type { Command, CommandResult, EngineContext, LogEntry, ServerState } from '../../shopping/engine';
import {
  createServer, defaultEngineContext, serverEntriesSince, serverSnapshot, serverSubmit,
} from '../../shopping/engine';
import type { ListMeta, SnapshotDto } from '../../shopping/types';

export interface SubmitOutcome {
  result: CommandResult;
  /** Same commandId seen before: nothing was written, the original result is returned. */
  duplicate: boolean;
  entry?: LogEntry;
}

/**
 * Persistence boundary for the shared shopping list. Mirrors L17a SQL-NOTES semantics:
 * one ordered, per-household command log (rejections included) with a seq cursor, idempotent on the
 * client-generated commandId, and every decision made atomically per household.
 *
 * TODO(L1): Supabase implementation = `record_purchase` / `void_purchase` functions + `shopping_command_log`.
 */
export interface ShoppingRepository {
  snapshot(householdId: string): Promise<SnapshotDto>;
  /** Apply one command (atomic per household). */
  submit(householdId: string, cmd: Command): Promise<SubmitOutcome>;
  /** Log entries with seq > cursor. */
  entriesSince(householdId: string, cursor: number): Promise<LogEntry[]>;
  /** Latest log seq (0 for an empty log). */
  head(householdId: string): Promise<number>;
  getMeta(householdId: string): Promise<ListMeta>;
  mergeMeta(householdId: string, meta: Partial<ListMeta>): Promise<void>;
}

interface HouseholdSlot {
  server: ServerState;
  meta: ListMeta;
  /** Serialises writes per household (stands in for the SQL row lock). */
  queue: Promise<unknown>;
}

/** In-memory implementation keyed by household. Process-local: lost on restart. */
export class InMemoryShoppingRepository implements ShoppingRepository {
  private readonly slots = new Map<string, HouseholdSlot>();

  constructor(private readonly ctx: EngineContext = defaultEngineContext) {}

  private slot(householdId: string): HouseholdSlot {
    let s = this.slots.get(householdId);
    if (!s) {
      s = { server: createServer(), meta: { recipeTitles: {} }, queue: Promise.resolve() };
      this.slots.set(householdId, s);
    }
    return s;
  }

  async snapshot(householdId: string): Promise<SnapshotDto> {
    const s = this.slot(householdId);
    const snap = serverSnapshot(s.server);
    return { cursor: snap.cursor, state: snap.state, meta: s.meta };
  }

  submit(householdId: string, cmd: Command): Promise<SubmitOutcome> {
    const s = this.slot(householdId);
    const run = s.queue.then(() => {
      const r = serverSubmit(s.server, cmd, this.ctx);
      s.server = r.server;
      return { result: r.result, duplicate: r.duplicate, ...(r.entry ? { entry: r.entry } : {}) };
    });
    s.queue = run.catch(() => undefined);
    return run;
  }

  async entriesSince(householdId: string, cursor: number): Promise<LogEntry[]> {
    return serverEntriesSince(this.slot(householdId).server, cursor);
  }

  async head(householdId: string): Promise<number> {
    return this.slot(householdId).server.log.length;
  }

  async getMeta(householdId: string): Promise<ListMeta> {
    return this.slot(householdId).meta;
  }

  async mergeMeta(householdId: string, meta: Partial<ListMeta>): Promise<void> {
    const s = this.slot(householdId);
    s.meta = { recipeTitles: { ...s.meta.recipeTitles, ...(meta.recipeTitles ?? {}) } };
  }

  /** Test/e2e helper. */
  reset(householdId?: string): void {
    if (householdId) this.slots.delete(householdId);
    else this.slots.clear();
  }
}

const KEY = Symbol.for('fr.shopping.repository');

/** Process-wide singleton (survives Next dev HMR and is shared by server components + server actions). */
export function getShoppingRepository(): ShoppingRepository {
  const g = globalThis as unknown as Record<symbol, ShoppingRepository | undefined>;
  return (g[KEY] ??= new InMemoryShoppingRepository());
}
