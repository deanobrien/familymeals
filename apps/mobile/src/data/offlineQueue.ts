import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Command, ShoppingState } from '@fr/engine/shopping';

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface CachedSnapshot {
  listId: string | null;
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
    private readonly prefix = 'fr.shopping.v1.',
  ) {}

  private pendingKey(householdId: string) {
    return `${this.prefix}pending.${householdId}`;
  }
  private snapshotKey(householdId: string) {
    return `${this.prefix}snapshot.${householdId}`;
  }

  async loadPending(householdId: string): Promise<Command[]> {
    try {
      const raw = await this.kv.getItem(this.pendingKey(householdId));
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isCommand) : [];
    } catch {
      return [];
    }
  }

  async savePending(householdId: string, pending: Command[]): Promise<void> {
    if (pending.length === 0) await this.kv.removeItem(this.pendingKey(householdId));
    else await this.kv.setItem(this.pendingKey(householdId), JSON.stringify(pending));
  }

  async loadSnapshot(householdId: string): Promise<CachedSnapshot | null> {
    try {
      const raw = await this.kv.getItem(this.snapshotKey(householdId));
      if (!raw) return null;
      const s = JSON.parse(raw) as Partial<CachedSnapshot>;
      if (!s || typeof s.cursor !== 'number' || !s.state || typeof s.state !== 'object') return null;
      return { listId: s.listId ?? null, cursor: s.cursor, state: s.state, members: s.members ?? {} };
    } catch {
      return null;
    }
  }

  async saveSnapshot(householdId: string, snap: CachedSnapshot): Promise<void> {
    try {
      await this.kv.setItem(this.snapshotKey(householdId), JSON.stringify(snap));
    } catch {
      /* cache only */
    }
  }

  async clear(householdId: string): Promise<void> {
    await this.kv.removeItem(this.pendingKey(householdId));
    await this.kv.removeItem(this.snapshotKey(householdId));
  }
}
