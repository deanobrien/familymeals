import type { PantryItem, Uuid } from '../../pantry/engine';
import { DEFAULT_STALE_AFTER_DAYS } from '../../pantry/engine';
import type { PantrySettings } from '../../pantry/types';

/** Persistence boundary. Swap the in-memory implementation for Supabase when the db lane merges. */
export interface PantryRepository {
  listItems(householdId: Uuid): Promise<PantryItem[]>;
  replaceItems(householdId: Uuid, items: readonly PantryItem[]): Promise<void>;
  getSettings(householdId: Uuid): Promise<PantrySettings>;
  saveSettings(householdId: Uuid, settings: PantrySettings): Promise<void>;
  /** Purchase events already applied or dismissed (so they are never suggested twice). */
  getHandledEventIds(householdId: Uuid): Promise<Set<Uuid>>;
  markEventsHandled(householdId: Uuid, ids: readonly Uuid[]): Promise<void>;
}

export const DEFAULT_SETTINGS: PantrySettings = { purchaseMode: 'suggest', staleAfterDays: DEFAULT_STALE_AFTER_DAYS };

export class InMemoryPantryRepository implements PantryRepository {
  private items = new Map<Uuid, PantryItem[]>();
  private settings = new Map<Uuid, PantrySettings>();
  private handled = new Map<Uuid, Set<Uuid>>();

  constructor(seed?: { householdId: Uuid; items: PantryItem[]; settings?: PantrySettings }) {
    if (seed) {
      this.items.set(seed.householdId, seed.items);
      if (seed.settings) this.settings.set(seed.householdId, seed.settings);
    }
  }

  async listItems(householdId: Uuid): Promise<PantryItem[]> {
    return structuredClone(this.items.get(householdId) ?? []);
  }
  async replaceItems(householdId: Uuid, items: readonly PantryItem[]): Promise<void> {
    this.items.set(householdId, structuredClone([...items]));
  }
  async getSettings(householdId: Uuid): Promise<PantrySettings> {
    return { ...(this.settings.get(householdId) ?? DEFAULT_SETTINGS) };
  }
  async saveSettings(householdId: Uuid, settings: PantrySettings): Promise<void> {
    this.settings.set(householdId, { ...settings });
  }
  async getHandledEventIds(householdId: Uuid): Promise<Set<Uuid>> {
    return new Set(this.handled.get(householdId) ?? []);
  }
  async markEventsHandled(householdId: Uuid, ids: readonly Uuid[]): Promise<void> {
    const set = this.handled.get(householdId) ?? new Set<Uuid>();
    for (const id of ids) set.add(id);
    this.handled.set(householdId, set);
  }
}
