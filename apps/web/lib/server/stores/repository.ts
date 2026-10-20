// Stores, aisles and placements (AS1, D290-D293). One interface, an in-memory implementation (mock mode / tests) and a
// Supabase one (../supabase/store-book-repository.ts). Ids are generated here (uuid), never taken from client input.
import type { PlacementTargetType, Store, StoreAisle, StoreBook, StorePlacement } from '../../shopping/engine';
import { STORE_TEMPLATES } from '../../shopping/engine';
import { AISLE_STEP } from '../../stores/schema';

export type TemplateId = keyof typeof STORE_TEMPLATES;

export interface StoreFields { name: string; chain: string | null; notes: string | null }

export class StoreBookError extends Error {
  constructor(readonly code: 'not_found' | 'duplicate_name' | 'invalid', message: string) {
    super(message);
    this.name = 'StoreBookError';
  }
}

export interface StoreBookRepository {
  book(householdId: string): Promise<StoreBook>;
  createStore(householdId: string, fields: StoreFields): Promise<Store>;
  updateStore(householdId: string, storeId: string, patch: Partial<StoreFields>): Promise<Store>;
  deleteStore(householdId: string, storeId: string): Promise<void>;
  addAisle(householdId: string, storeId: string, label: string): Promise<StoreAisle>;
  renameAisle(householdId: string, aisleId: string, label: string): Promise<void>;
  /** Set the order of a store's aisles (ids not listed keep their relative order after the listed ones). */
  reorderAisles(householdId: string, storeId: string, orderedAisleIds: string[]): Promise<void>;
  deleteAisle(householdId: string, aisleId: string): Promise<void>;
  /** Place a target in an aisle of the store; `aisleId = null` clears the placement. Replaces any earlier placement. */
  setPlacement(householdId: string, storeId: string, targetType: PlacementTargetType, targetKey: string, aisleId: string | null): Promise<void>;
  /** Replace the target store's aisles and placements with a copy of the source store's. Returns the aisles copied. */
  copyLayout(householdId: string, fromStoreId: string, toStoreId: string): Promise<number>;
  reset(householdId?: string): void;
}

/**
 * Add a starting template to a store: one aisle per template aisle (skipping labels the store already has) and a category
 * placement for each category the template maps. Existing placements are never overwritten.
 * Built on the primitive operations, so both backends share it.
 */
export async function applyTemplate(repo: StoreBookRepository, householdId: string, storeId: string, templateId: TemplateId): Promise<void> {
  const tpl = STORE_TEMPLATES[templateId];
  if (!tpl) throw new StoreBookError('invalid', 'unknown template');
  const book = await repo.book(householdId);
  if (!book.stores.some((s) => s.id === storeId)) throw new StoreBookError('not_found', 'store not found');
  const have = new Map(book.aisles.filter((a) => a.storeId === storeId).map((a) => [a.label.toLowerCase(), a.id]));
  const taken = new Set(book.placements.filter((p) => p.storeId === storeId && p.targetType === 'category').map((p) => p.targetKey));
  for (const t of tpl.aisles) {
    let id = have.get(t.label.toLowerCase());
    if (!id) {
      id = (await repo.addAisle(householdId, storeId, t.label)).id;
      have.set(t.label.toLowerCase(), id);
    }
    for (const c of t.categories) {
      if (taken.has(c)) continue;
      taken.add(c);
      await repo.setPlacement(householdId, storeId, 'category', c, id);
    }
  }
}

interface Slot { stores: Store[]; aisles: StoreAisle[]; placements: StorePlacement[] }

/** In-memory implementation keyed by household. Process-local: lost on restart (mock mode). */
export class InMemoryStoreBookRepository implements StoreBookRepository {
  private readonly slots = new Map<string, Slot>();
  constructor(private readonly newId: () => string = () => crypto.randomUUID()) {}

  private slot(h: string): Slot {
    let s = this.slots.get(h);
    if (!s) this.slots.set(h, (s = { stores: [], aisles: [], placements: [] }));
    return s;
  }
  private store(h: string, id: string): Store {
    const s = this.slot(h).stores.find((x) => x.id === id);
    if (!s) throw new StoreBookError('not_found', 'store not found');
    return s;
  }
  private aisle(h: string, id: string): StoreAisle {
    const a = this.slot(h).aisles.find((x) => x.id === id);
    if (!a) throw new StoreBookError('not_found', 'aisle not found');
    return a;
  }

  async book(h: string): Promise<StoreBook> {
    const s = this.slot(h);
    return structuredClone({
      stores: [...s.stores].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.id.localeCompare(b.id)),
      aisles: [...s.aisles].sort((a, b) => a.storeId.localeCompare(b.storeId) || a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)),
      placements: s.placements,
    });
  }

  async createStore(h: string, f: StoreFields): Promise<Store> {
    const s = this.slot(h);
    if (s.stores.some((x) => x.name.trim().toLowerCase() === f.name.trim().toLowerCase())) throw new StoreBookError('duplicate_name', 'You already have a store with that name.');
    const store: Store = { id: this.newId(), name: f.name.trim(), chain: f.chain, notes: f.notes };
    s.stores.push(store);
    return { ...store };
  }

  async updateStore(h: string, id: string, patch: Partial<StoreFields>): Promise<Store> {
    const s = this.slot(h);
    const cur = this.store(h, id);
    if (patch.name !== undefined && s.stores.some((x) => x.id !== id && x.name.trim().toLowerCase() === patch.name!.trim().toLowerCase())) {
      throw new StoreBookError('duplicate_name', 'You already have a store with that name.');
    }
    if (patch.name !== undefined) cur.name = patch.name.trim();
    if (patch.chain !== undefined) cur.chain = patch.chain;
    if (patch.notes !== undefined) cur.notes = patch.notes;
    return { ...cur };
  }

  async deleteStore(h: string, id: string): Promise<void> {
    const s = this.slot(h);
    s.stores = s.stores.filter((x) => x.id !== id);
    s.aisles = s.aisles.filter((x) => x.storeId !== id);
    s.placements = s.placements.filter((x) => x.storeId !== id);
  }

  async addAisle(h: string, storeId: string, label: string): Promise<StoreAisle> {
    this.store(h, storeId);
    const s = this.slot(h);
    const max = s.aisles.filter((a) => a.storeId === storeId).reduce((m, a) => Math.max(m, a.sortOrder), 0);
    const aisle: StoreAisle = { id: this.newId(), storeId, label: label.trim(), sortOrder: max + AISLE_STEP };
    s.aisles.push(aisle);
    return { ...aisle };
  }

  async renameAisle(h: string, id: string, label: string): Promise<void> {
    this.aisle(h, id).label = label.trim();
  }

  async reorderAisles(h: string, storeId: string, ordered: string[]): Promise<void> {
    this.store(h, storeId);
    const mine = this.slot(h).aisles.filter((a) => a.storeId === storeId).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
    const listed = ordered.filter((id, i) => ordered.indexOf(id) === i && mine.some((a) => a.id === id));
    const rest = mine.filter((a) => !listed.includes(a.id)).map((a) => a.id);
    [...listed, ...rest].forEach((id, i) => { this.aisle(h, id).sortOrder = (i + 1) * AISLE_STEP; });
  }

  async deleteAisle(h: string, id: string): Promise<void> {
    const s = this.slot(h);
    s.aisles = s.aisles.filter((a) => a.id !== id);
    s.placements = s.placements.filter((p) => p.aisleId !== id);
  }

  async setPlacement(h: string, storeId: string, type: PlacementTargetType, key: string, aisleId: string | null): Promise<void> {
    this.store(h, storeId);
    const s = this.slot(h);
    s.placements = s.placements.filter((p) => !(p.storeId === storeId && p.targetType === type && p.targetKey === key));
    if (aisleId === null) return;
    if (this.aisle(h, aisleId).storeId !== storeId) throw new StoreBookError('invalid', 'That aisle belongs to a different store.');
    s.placements.push({ storeId, targetType: type, targetKey: key, aisleId });
  }

  async copyLayout(h: string, from: string, to: string): Promise<number> {
    if (from === to) throw new StoreBookError('invalid', 'Choose a different store to copy from.');
    this.store(h, from);
    this.store(h, to);
    const s = this.slot(h);
    s.aisles = s.aisles.filter((a) => a.storeId !== to);
    s.placements = s.placements.filter((p) => p.storeId !== to);
    const map = new Map<string, string>();
    for (const a of s.aisles.filter((x) => x.storeId === from)) {
      const id = this.newId();
      map.set(a.id, id);
      s.aisles.push({ id, storeId: to, label: a.label, sortOrder: a.sortOrder });
    }
    for (const p of s.placements.filter((x) => x.storeId === from)) {
      const aisleId = map.get(p.aisleId);
      if (aisleId) s.placements.push({ ...p, storeId: to, aisleId });
    }
    return map.size;
  }

  reset(h?: string): void {
    if (h) this.slots.delete(h);
    else this.slots.clear();
  }
}

const KEY = Symbol.for('fr.stores.repository');
/** Process-wide in-memory singleton (survives Next dev HMR; shared by server components and actions). */
export function getMemoryStoreBook(): InMemoryStoreBookRepository {
  const g = globalThis as unknown as Record<symbol, InMemoryStoreBookRepository | undefined>;
  return (g[KEY] ??= new InMemoryStoreBookRepository());
}
