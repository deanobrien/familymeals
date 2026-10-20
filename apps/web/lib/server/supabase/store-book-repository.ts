// Supabase store book (AS1, D290-D293): stores / store_aisles / store_placements as the signed-in user under RLS
// (any member of a writable household writes), plus `household_store_book` (one round trip) and `copy_store_layout`.
import 'server-only';
import type { PlacementTargetType, Store, StoreAisle, StoreBook, StorePlacement } from '../../shopping/engine';
import { AISLE_STEP } from '../../stores/schema';
import { StoreBookError, type StoreBookRepository, type StoreFields } from '../stores/repository';
import { SupabaseRepositoryError, callRpc, unwrap, type SupabaseClient } from './rpc';

type Row = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** A `household_store_book` payload -> StoreBook, dropping anything malformed. */
export function bookFromJson(json: unknown): StoreBook {
  const o = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const arr = (k: string): Row[] => (Array.isArray(o[k]) ? (o[k] as Row[]) : []);
  const stores: Store[] = arr('stores').filter((s) => s.id && s.name).map((s) => ({
    id: str(s.id), name: str(s.name), chain: typeof s.chain === 'string' ? s.chain : null, notes: typeof s.notes === 'string' ? s.notes : null,
  }));
  const aisles: StoreAisle[] = arr('aisles').filter((a) => a.id && a.storeId).map((a) => ({
    id: str(a.id), storeId: str(a.storeId), label: str(a.label), sortOrder: Number(a.sortOrder) || 0,
  }));
  const placements: StorePlacement[] = arr('placements')
    .filter((p) => p.storeId && p.aisleId && ['ingredient', 'item', 'category'].includes(str(p.targetType)))
    .map((p) => ({ storeId: str(p.storeId), aisleId: str(p.aisleId), targetType: str(p.targetType) as PlacementTargetType, targetKey: str(p.targetKey) }));
  return { stores, aisles, placements };
}

function map(op: string, e: unknown): never {
  if (e instanceof SupabaseRepositoryError) {
    if (e.code === '23505') throw new StoreBookError('duplicate_name', 'You already have a store with that name.');
    if (e.code === '23503' || e.code === '22023') throw new StoreBookError('invalid', 'That does not belong together.');
    if (e.code === 'P0002') throw new StoreBookError('not_found', 'Not found.');
  }
  throw e;
}

export class SupabaseStoreBookRepository implements StoreBookRepository {
  constructor(private readonly client: SupabaseClient, private readonly userId: string | null) {}

  async book(householdId: string): Promise<StoreBook> {
    return bookFromJson(await callRpc(this.client, 'household_store_book', { p_household_id: householdId }));
  }

  async createStore(householdId: string, f: StoreFields): Promise<Store> {
    try {
      const row = unwrap<Row[]>('createStore', await this.client.from('stores')
        .insert({ household_id: householdId, name: f.name.trim(), chain: f.chain, notes: f.notes, created_by: this.userId })
        .select('id, name, chain, notes') as never)?.[0];
      return { id: str(row?.id), name: str(row?.name), chain: (row?.chain as string | null) ?? null, notes: (row?.notes as string | null) ?? null };
    } catch (e) { return map('createStore', e); }
  }

  async updateStore(householdId: string, id: string, patch: Partial<StoreFields>): Promise<Store> {
    const set: Row = { updated_at: new Date().toISOString() };
    if (patch.name !== undefined) set.name = patch.name.trim();
    if (patch.chain !== undefined) set.chain = patch.chain;
    if (patch.notes !== undefined) set.notes = patch.notes;
    try {
      const rows = unwrap<Row[]>('updateStore', await this.client.from('stores').update(set)
        .eq('id', id).eq('household_id', householdId).select('id, name, chain, notes') as never) ?? [];
      const row = rows[0];
      if (!row) throw new StoreBookError('not_found', 'store not found');
      return { id: str(row.id), name: str(row.name), chain: (row.chain as string | null) ?? null, notes: (row.notes as string | null) ?? null };
    } catch (e) { return map('updateStore', e); }
  }

  async deleteStore(householdId: string, id: string): Promise<void> {
    unwrap('deleteStore', await this.client.from('stores').delete().eq('id', id).eq('household_id', householdId) as never);
  }

  async addAisle(householdId: string, storeId: string, label: string): Promise<StoreAisle> {
    const last = unwrap<Row[]>('addAisle', await this.client.from('store_aisles').select('sort_order')
      .eq('store_id', storeId).eq('household_id', householdId).order('sort_order', { ascending: false }).range(0, 0) as never) ?? [];
    const sortOrder = (Number(last[0]?.sort_order) || 0) + AISLE_STEP;
    try {
      const row = unwrap<Row[]>('addAisle', await this.client.from('store_aisles')
        .insert({ household_id: householdId, store_id: storeId, label: label.trim(), sort_order: sortOrder })
        .select('id, store_id, label, sort_order') as never)?.[0];
      return { id: str(row?.id), storeId: str(row?.store_id), label: str(row?.label), sortOrder: Number(row?.sort_order) };
    } catch (e) { return map('addAisle', e); }
  }

  async renameAisle(householdId: string, id: string, label: string): Promise<void> {
    unwrap('renameAisle', await this.client.from('store_aisles').update({ label: label.trim() }).eq('id', id).eq('household_id', householdId) as never);
  }

  async reorderAisles(householdId: string, storeId: string, ordered: string[]): Promise<void> {
    const mine = unwrap<Row[]>('reorderAisles', await this.client.from('store_aisles').select('id, sort_order')
      .eq('store_id', storeId).eq('household_id', householdId).order('sort_order', { ascending: true }) as never) ?? [];
    const ids = mine.map((r) => str(r.id));
    const listed = ordered.filter((id, i) => ordered.indexOf(id) === i && ids.includes(id));
    const full = [...listed, ...ids.filter((id) => !listed.includes(id))];
    const changed = full.map((id, i) => ({ id, order: (i + 1) * AISLE_STEP })).filter((x) => Number(mine.find((r) => r.id === x.id)?.sort_order) !== x.order);
    for (const c of changed) {
      unwrap('reorderAisles', await this.client.from('store_aisles').update({ sort_order: c.order }).eq('id', c.id).eq('household_id', householdId) as never);
    }
  }

  async deleteAisle(householdId: string, id: string): Promise<void> {
    unwrap('deleteAisle', await this.client.from('store_aisles').delete().eq('id', id).eq('household_id', householdId) as never);
  }

  async setPlacement(householdId: string, storeId: string, type: PlacementTargetType, key: string, aisleId: string | null): Promise<void> {
    try {
      if (aisleId === null) {
        unwrap('setPlacement', await this.client.from('store_placements').delete()
          .eq('household_id', householdId).eq('store_id', storeId).eq('target_type', type).eq('target_key', key) as never);
        return;
      }
      unwrap('setPlacement', await this.client.from('store_placements').upsert(
        { household_id: householdId, store_id: storeId, aisle_id: aisleId, target_type: type, target_key: key, created_by: this.userId, updated_at: new Date().toISOString() },
        { onConflict: 'store_id,target_type,target_key' },
      ) as never);
    } catch (e) { map('setPlacement', e); }
  }

  async copyLayout(householdId: string, from: string, to: string): Promise<number> {
    try {
      return Number(await callRpc(this.client, 'copy_store_layout', { p_household_id: householdId, p_from_store: from, p_to_store: to })) || 0;
    } catch (e) { return map('copyLayout', e); }
  }

  reset(): void { /* nothing cached */ }
}
