// Supabase-backed PantryRepository (lane S1, DECISIONS D50-D59).
// pantry_items <-> engine PantryItem; settings in pantry_settings; handled purchase events in pantry_handled_events.
// replaceItems goes through replace_pantry_items (0015): one transaction, id-keyed upsert + delete of absent rows.
import { toDbRow, type DbRow } from '@fr/domain';
import type { PantryItem, Uuid } from '../../pantry/engine';
import type { PantrySettings, PurchaseMode } from '../../pantry/types';
import { DEFAULT_SETTINGS, type PantryRepository } from '../pantry/repository';
import { safeQuantity } from './recipe-mapper';
import { callRpc, isUuid, selectAll, toIso, unwrap, type PgResult, type SupabaseClient } from './rpc';

const MODES: readonly PurchaseMode[] = ['off', 'suggest', 'auto'];

export function pantryItemFromRow(row: DbRow): PantryItem {
  const events = Array.isArray(row.source_event_ids) ? (row.source_event_ids as unknown[]).map(String) : [];
  return {
    id: String(row.id),
    householdId: String(row.household_id),
    ...(row.ingredient_id ? { ingredientId: String(row.ingredient_id) } : {}),
    name: String(row.display_name),
    quantity: safeQuantity(row),
    ...(row.expires_on ? { expiry: String(row.expires_on) } : {}),
    // stock_updated_at carries the engine's own "last confirmed" instant; updated_at is bumped by a trigger on every write
    lastUpdated: toIso(row.stock_updated_at ?? row.updated_at),
    source: row.source as PantryItem['source'],
    ...(events.length > 0 ? { sourceEventIds: events } : {}),
  };
}

export function pantryItemToRpcRow(item: PantryItem): DbRow {
  return {
    id: item.id,
    ...toDbRow({
      ingredientId: item.ingredientId ?? null,
      displayName: item.name,
      quantity: item.quantity,
      expiresOn: item.expiry ?? null,
      source: item.source,
      sourceEventIds: item.sourceEventIds ?? [],
      stockUpdatedAt: item.lastUpdated,
    }),
  };
}

export class SupabasePantryRepository implements PantryRepository {
  constructor(private readonly client: SupabaseClient) {}

  async listItems(householdId: Uuid): Promise<PantryItem[]> {
    if (!isUuid(householdId)) return [];
    const rows = await selectAll<DbRow>('list pantry_items', (from, to) =>
      this.client
        .from('pantry_items')
        .select('*')
        .eq('household_id', householdId)
        .order('display_name', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<PgResult<DbRow[]>>,
    );
    return rows.map(pantryItemFromRow);
  }

  async replaceItems(householdId: Uuid, items: readonly PantryItem[]): Promise<void> {
    if (!isUuid(householdId)) throw new Error(`Household id must be a UUID (got "${householdId}")`);
    const bad = items.find((i) => !isUuid(i.id));
    if (bad) throw new Error(`Pantry item id must be a UUID (got "${bad.id}")`);
    await callRpc<null>(this.client)('replace_pantry_items', { p_household_id: householdId, p_items: items.map(pantryItemToRpcRow) });
  }

  async getSettings(householdId: Uuid): Promise<PantrySettings> {
    if (!isUuid(householdId)) return { ...DEFAULT_SETTINGS };
    const res = (await this.client
      .from('pantry_settings')
      .select('purchase_mode, stale_after_days')
      .eq('household_id', householdId)
      .maybeSingle()) as PgResult<{ purchase_mode: string; stale_after_days: number }>;
    const row = unwrap('get pantry_settings', res);
    if (!row) return { ...DEFAULT_SETTINGS };
    return {
      purchaseMode: MODES.includes(row.purchase_mode as PurchaseMode) ? (row.purchase_mode as PurchaseMode) : DEFAULT_SETTINGS.purchaseMode,
      staleAfterDays: Number(row.stale_after_days),
    };
  }

  async saveSettings(householdId: Uuid, settings: PantrySettings): Promise<void> {
    if (!isUuid(householdId)) throw new Error(`Household id must be a UUID (got "${householdId}")`);
    const res = (await this.client
      .from('pantry_settings')
      .upsert(
        { household_id: householdId, purchase_mode: settings.purchaseMode, stale_after_days: settings.staleAfterDays },
        { onConflict: 'household_id' },
      )) as PgResult<unknown>;
    unwrap('save pantry_settings', res);
  }

  async getHandledEventIds(householdId: Uuid): Promise<Set<Uuid>> {
    if (!isUuid(householdId)) return new Set();
    const rows = await selectAll<{ purchase_event_id: string }>('list pantry_handled_events', (from, to) =>
      this.client
        .from('pantry_handled_events')
        .select('purchase_event_id')
        .eq('household_id', householdId)
        .order('purchase_event_id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<PgResult<{ purchase_event_id: string }[]>>,
    );
    return new Set(rows.map((r) => r.purchase_event_id));
  }

  async markEventsHandled(householdId: Uuid, ids: readonly Uuid[]): Promise<void> {
    if (ids.length === 0) return;
    if (!isUuid(householdId)) throw new Error(`Household id must be a UUID (got "${householdId}")`);
    const bad = ids.find((i) => !isUuid(i));
    if (bad) throw new Error(`Purchase event id must be a UUID (got "${bad}")`);
    const res = (await this.client
      .from('pantry_handled_events')
      .upsert(
        [...new Set(ids)].map((purchase_event_id) => ({ household_id: householdId, purchase_event_id })),
        { onConflict: 'household_id,purchase_event_id', ignoreDuplicates: true },
      )) as PgResult<unknown>;
    unwrap('mark pantry_handled_events', res);
  }
}
