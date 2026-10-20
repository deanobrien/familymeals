import { randomUUID } from 'node:crypto';
import type { Command, CommandResult, EngineContext, LogEntry, ServerState } from '../../shopping/engine';
import {
  createServer, defaultEngineContext, serverEntriesSince, serverSnapshot, serverSubmit,
} from '../../shopping/engine';
import type { ListMeta, ShoppingListInfo, SnapshotDto } from '../../shopping/types';
import { getIngredientCatalogue } from '../refdata/catalogue';

export interface SubmitOutcome {
  result: CommandResult;
  /** Same commandId seen before: nothing was written, the original result is returned. */
  duplicate: boolean;
  entry?: LogEntry;
}

export const DEFAULT_LIST_NAME = 'Shopping list';
export const MAX_LIST_NAME = 120;
/** Trim, collapse whitespace, cap. Empty -> null (callers refuse a nameless list). */
export function cleanListName(name: unknown): string | null {
  const n = String(name ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_LIST_NAME);
  return n || null;
}

/**
 * Persistence boundary for the shared shopping list. Mirrors L17a SQL-NOTES semantics:
 * one ordered, per-household command log (rejections included) with a seq cursor, idempotent on the
 * client-generated commandId, and every decision made atomically per household.
 *
 * Since SL1 (D263) a household can hold several named lists, exactly ONE active: every method below that takes only a
 * household means "its active list". Creating a list archives the active one (kept whole); activating an older list
 * archives the current one. The list ops are idempotent on the list id.
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
  /** Id of the active list, or null when the household has none yet (created by its first write). */
  activeListId(householdId: string): Promise<string | null>;
  /** The active list first, then the archived ones, newest first. */
  listLists(householdId: string): Promise<ShoppingListInfo[]>;
  /** New named list, which becomes the active one (the previous active list is archived). Idempotent on `id`. */
  createList(householdId: string, input: { id: string; name: string }): Promise<ShoppingListInfo>;
  /** Make an existing list the active one (the current active list is archived). False when it does not exist. */
  activateList(householdId: string, listId: string): Promise<boolean>;
  renameList(householdId: string, listId: string, name: string): Promise<boolean>;
  /** Archive the active list (kept whole). The next write starts a fresh default list. */
  archiveActiveList(householdId: string): Promise<boolean>;
}

interface ListSlot {
  id: string;
  name: string;
  server: ServerState;
  meta: ListMeta;
  updatedAt: string;
}

interface HouseholdSlot {
  /** The active list, or null after it was archived (the next write creates a fresh one). */
  active: ListSlot | null;
  archived: ListSlot[];
  /** Serialises writes per household (stands in for the SQL row lock). */
  queue: Promise<unknown>;
}

const newList = (id: string, name: string, now: string): ListSlot => ({
  id, name, server: createServer(), meta: { recipeTitles: {} }, updatedAt: now,
});

/** In-memory implementation keyed by household. Process-local: lost on restart. */
export class InMemoryShoppingRepository implements ShoppingRepository {
  private readonly slots = new Map<string, HouseholdSlot>();

  constructor(
    private readonly ctx: EngineContext = defaultEngineContext,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  private household(householdId: string): HouseholdSlot {
    let s = this.slots.get(householdId);
    if (!s) {
      s = { active: newList(randomUUID(), DEFAULT_LIST_NAME, this.now()), archived: [], queue: Promise.resolve() };
      this.slots.set(householdId, s);
    }
    return s;
  }

  /** The active list for reading: when none exists an empty, unsaved placeholder (never stored by a read). */
  private read(householdId: string): ListSlot {
    return this.household(householdId).active ?? { ...newList('', DEFAULT_LIST_NAME, this.now()) };
  }

  private metaOf(l: ListSlot): ListMeta {
    return { recipeTitles: l.meta.recipeTitles, ...(l.id ? { listId: l.id, listName: l.name } : {}) };
  }

  async snapshot(householdId: string): Promise<SnapshotDto> {
    const l = this.read(householdId);
    const snap = serverSnapshot(l.server);
    return { cursor: snap.cursor, state: snap.state, meta: this.metaOf(l) };
  }

  submit(householdId: string, cmd: Command): Promise<SubmitOutcome> {
    const h = this.household(householdId);
    const run = h.queue.then(() => {
      // A write after the active list was archived starts a fresh default list (like ensure_shopping_list).
      const l = (h.active ??= newList(randomUUID(), DEFAULT_LIST_NAME, this.now()));
      const r = serverSubmit(l.server, cmd, this.ctx);
      l.server = r.server;
      if (!r.duplicate) l.updatedAt = this.now();
      return { result: r.result, duplicate: r.duplicate, ...(r.entry ? { entry: r.entry } : {}) };
    });
    h.queue = run.catch(() => undefined);
    return run;
  }

  async entriesSince(householdId: string, cursor: number): Promise<LogEntry[]> {
    return serverEntriesSince(this.read(householdId).server, cursor);
  }

  async head(householdId: string): Promise<number> {
    return this.read(householdId).server.log.length;
  }

  async getMeta(householdId: string): Promise<ListMeta> {
    return this.metaOf(this.read(householdId));
  }

  async mergeMeta(householdId: string, meta: Partial<ListMeta>): Promise<void> {
    const h = this.household(householdId);
    const l = (h.active ??= newList(randomUUID(), DEFAULT_LIST_NAME, this.now()));
    l.meta = { recipeTitles: { ...l.meta.recipeTitles, ...(meta.recipeTitles ?? {}) } };
  }

  async activeListId(householdId: string): Promise<string | null> {
    return this.household(householdId).active?.id ?? null;
  }

  private info(l: ListSlot, status: ShoppingListInfo['status']): ShoppingListInfo {
    return { id: l.id, name: l.name, status, updatedAt: l.updatedAt };
  }

  async listLists(householdId: string): Promise<ShoppingListInfo[]> {
    const h = this.household(householdId);
    const archived = [...h.archived].reverse().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((l) => this.info(l, 'archived'));
    return h.active ? [this.info(h.active, 'active'), ...archived] : archived;
  }

  async createList(householdId: string, input: { id: string; name: string }): Promise<ShoppingListInfo> {
    const h = this.household(householdId);
    // Serialised with submit(): a command in flight lands in the list it was decided for.
    const run = h.queue.then(() => {
      const name = cleanListName(input.name);
      if (!name) throw new Error('a list needs a name');
      const existing = [h.active, ...h.archived].find((l) => l?.id === input.id);
      if (existing) return this.info(existing, existing === h.active ? 'active' : 'archived');
      if (h.active) h.archived.push(h.active);
      h.active = newList(input.id, name, this.now());
      return this.info(h.active, 'active');
    });
    h.queue = run.catch(() => undefined);
    return run;
  }

  async activateList(householdId: string, listId: string): Promise<boolean> {
    const h = this.household(householdId);
    const run = h.queue.then(() => {
      if (h.active?.id === listId) return true;
      const target = h.archived.find((l) => l.id === listId);
      if (!target) return false;
      h.archived = h.archived.filter((l) => l !== target);
      if (h.active) h.archived.push(h.active);
      h.active = target;
      return true;
    });
    h.queue = run.catch(() => undefined);
    return run;
  }

  async renameList(householdId: string, listId: string, name: string): Promise<boolean> {
    const h = this.household(householdId);
    const clean = cleanListName(name);
    const target = [h.active, ...h.archived].find((l) => l?.id === listId);
    if (!clean || !target) return false;
    target.name = clean;
    target.updatedAt = this.now();
    return true;
  }

  async archiveActiveList(householdId: string): Promise<boolean> {
    const h = this.household(householdId);
    const run = h.queue.then(() => {
      if (!h.active) return false;
      h.archived.push(h.active);
      h.active = null;
      return true;
    });
    h.queue = run.catch(() => undefined);
    return run;
  }

  /** Test/e2e helper. */
  reset(householdId?: string): void {
    if (householdId) this.slots.delete(householdId);
    else this.slots.clear();
  }
}

const KEY = Symbol.for('fr.shopping.repository');

/**
 * Process-wide singleton (survives Next dev HMR and is shared by server components + server actions).
 * Server decisions convert units with the refdata catalogue (density / unit weights).
 */
export function getShoppingRepository(): InMemoryShoppingRepository {
  const g = globalThis as unknown as Record<symbol, InMemoryShoppingRepository | undefined>;
  return (g[KEY] ??= new InMemoryShoppingRepository({ converter: getIngredientCatalogue().converter }));
}
