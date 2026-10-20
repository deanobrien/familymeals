import AsyncStorage from '@react-native-async-storage/async-storage';
import { emptyState, type Command, type ShoppingState } from '@fr/engine/shopping';

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface CachedSnapshot {
  listId: string | null;
  /** The list's `list_seq` (per-list commit-ordered cursor), persisted per list. */
  cursor: number;
  state: ShoppingState;
  members: Record<string, string>;
}

const COMMAND_TYPES = new Set(['tick', 'purchase', 'undo', 'add_item', 'edit_item', 'remove_item', 'regenerate']);

function isCommand(v: unknown): v is Command {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return typeof c.commandId === 'string' && typeof c.type === 'string' && COMMAND_TYPES.has(c.type);
}

/**
 * AsyncStorage persistence for the offline shopping queue (the engine's `ClientState.pending`) plus the last
 * confirmed snapshot, so a cold start with no signal still shows the list with the queued ticks applied.
 * Corrupt entries are dropped, never thrown: losing a cache must not brick the screen.
 */
export class OfflineStore {
  constructor(
    private readonly kv: KeyValueStore = AsyncStorage,
    private readonly prefix = 'fr.shopping.v2.',
  ) {}

  private pendingKey(householdId: string) {
    return `${this.prefix}pending.${householdId}`;
  }
  /** v1 keys held a global-`seq` cursor (unusable now); only the queued commands are still valid. */
  private legacyPendingKey(householdId: string) {
    return `fr.shopping.v1.pending.${householdId}`;
  }
  /** Which list this household last had, plus the member names (small, changes rarely). */
  private activeKey(householdId: string) {
    return `${this.prefix}active.${householdId}`;
  }
  /** One record per LIST: its confirmed state and the `list_seq` cursor that state is current to (kept together). */
  private listKey(listId: string) {
    return `${this.prefix}list.${listId}`;
  }

  async loadPending(householdId: string): Promise<Command[]> {
    try {
      const raw = (await this.kv.getItem(this.pendingKey(householdId))) ?? (await this.kv.getItem(this.legacyPendingKey(householdId)));
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isCommand) : [];
    } catch {
      return [];
    }
  }

  async savePending(householdId: string, pending: Command[]): Promise<void> {
    await this.kv.removeItem(this.legacyPendingKey(householdId));
    if (pending.length === 0) await this.kv.removeItem(this.pendingKey(householdId));
    else await this.kv.setItem(this.pendingKey(householdId), JSON.stringify(pending));
  }

  async loadSnapshot(householdId: string): Promise<CachedSnapshot | null> {
    try {
      const rawActive = await this.kv.getItem(this.activeKey(householdId));
      if (!rawActive) return null;
      const active = JSON.parse(rawActive) as { listId?: string | null; members?: Record<string, string> };
      const members = active.members ?? {};
      if (!active.listId) return { listId: null, cursor: 0, state: emptyState(), members };
      const rawList = await this.kv.getItem(this.listKey(active.listId));
      if (!rawList) return null;
      const l = JSON.parse(rawList) as { cursor?: unknown; state?: ShoppingState };
      if (!l || typeof l.cursor !== 'number' || !l.state || typeof l.state !== 'object') return null;
      return { listId: active.listId, cursor: l.cursor, state: l.state, members };
    } catch {
      return null;
    }
  }

  async saveSnapshot(householdId: string, snap: CachedSnapshot): Promise<void> {
    try {
      if (snap.listId) await this.kv.setItem(this.listKey(snap.listId), JSON.stringify({ cursor: snap.cursor, state: snap.state }));
      await this.kv.setItem(this.activeKey(householdId), JSON.stringify({ listId: snap.listId, members: snap.members }));
    } catch {
      /* cache only */
    }
  }

  /** Small per-household values (AS1): the cached store book and the selected store. */
  async loadValue<T>(householdId: string, name: string): Promise<T | null> {
    try {
      const raw = await this.kv.getItem(`${this.prefix}${name}.${householdId}`);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  async saveValue(householdId: string, name: string, value: unknown): Promise<void> {
    try {
      if (value === null || value === undefined) await this.kv.removeItem(`${this.prefix}${name}.${householdId}`);
      else await this.kv.setItem(`${this.prefix}${name}.${householdId}`, JSON.stringify(value));
    } catch {
      /* cache only */
    }
  }

  async clear(householdId: string): Promise<void> {
    await this.kv.removeItem(this.pendingKey(householdId));
    await this.kv.removeItem(this.legacyPendingKey(householdId));
    try {
      const raw = await this.kv.getItem(this.activeKey(householdId));
      const listId = raw ? (JSON.parse(raw) as { listId?: string | null }).listId : null;
      if (listId) await this.kv.removeItem(this.listKey(listId));
    } catch {
      /* cache only */
    }
    await this.kv.removeItem(this.activeKey(householdId));
  }
}
