// Supabase-backed RestockRepository (PR1, D280-D289): pantry_par_levels + restock_settings, as the signed-in user (RLS).
import type { DbRow } from '@fr/domain';
import type { ParLevel, RestockUnit, Uuid } from '../../pantry/engine';
import { DEFAULT_RESTOCK_SETTINGS, type RestockSettings } from '../../restock/types';
import type { RestockRepository } from '../restock/repository';
import { isUuid, selectAll, unwrap, type PgResult, type SupabaseClient } from './rpc';

export function parFromRow(row: DbRow): ParLevel {
  return {
    id: String(row.id),
    householdId: String(row.household_id),
    ...(row.ingredient_id ? { ingredientId: String(row.ingredient_id) } : {}),
    name: String(row.display_name),
    unit: String(row.unit) as RestockUnit,
    minValue: Number(row.min_value),
    ...(row.restock_to_value !== null && row.restock_to_value !== undefined ? { restockToValue: Number(row.restock_to_value) } : {}),
    ...(row.pack_value !== null && row.pack_value !== undefined && row.pack_unit
      ? { pack: { value: Number(row.pack_value), unit: String(row.pack_unit) as RestockUnit } } : {}),
    enabled: row.enabled !== false,
    ...(row.snoozed_until ? { snoozedUntil: String(row.snoozed_until).slice(0, 10) } : {}),
  };
}

export function parToRow(householdId: Uuid, par: ParLevel): DbRow {
  return {
    id: par.id,
    household_id: householdId,
    ingredient_id: par.ingredientId ?? null,
    display_name: par.name,
    unit: par.unit,
    min_value: par.minValue,
    restock_to_value: par.restockToValue ?? null,
    pack_value: par.pack?.value ?? null,
    pack_unit: par.pack?.unit ?? null,
    enabled: par.enabled,
    snoozed_until: par.snoozedUntil ?? null,
  };
}

export class SupabaseRestockRepository implements RestockRepository {
  constructor(private readonly client: SupabaseClient) {}

  async listPars(householdId: Uuid): Promise<ParLevel[]> {
    if (!isUuid(householdId)) return [];
    const rows = await selectAll<DbRow>('list pantry_par_levels', (from, to) =>
      this.client
        .from('pantry_par_levels')
        .select('*')
        .eq('household_id', householdId)
        .order('display_name', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<PgResult<DbRow[]>>,
    );
    return rows.map(parFromRow);
  }

  async savePar(householdId: Uuid, par: ParLevel): Promise<void> {
    if (!isUuid(householdId) || !isUuid(par.id)) throw new Error('Household and minimum ids must be UUIDs');
    const res = (await this.client
      .from('pantry_par_levels')
      .upsert(parToRow(householdId, par), { onConflict: 'id' })) as PgResult<unknown>;
    unwrap('save pantry_par_levels', res);
  }

  async deletePar(householdId: Uuid, id: Uuid): Promise<void> {
    if (!isUuid(householdId) || !isUuid(id)) return;
    const res = (await this.client
      .from('pantry_par_levels')
      .delete()
      .eq('household_id', householdId)
      .eq('id', id)) as PgResult<unknown>;
    unwrap('delete pantry_par_levels', res);
  }

  async getSettings(householdId: Uuid): Promise<RestockSettings> {
    if (!isUuid(householdId)) return { ...DEFAULT_RESTOCK_SETTINGS };
    const res = (await this.client
      .from('restock_settings')
      .select('auto_add')
      .eq('household_id', householdId)
      .maybeSingle()) as PgResult<{ auto_add: boolean }>;
    const row = unwrap('get restock_settings', res);
    return row ? { autoAdd: row.auto_add === true } : { ...DEFAULT_RESTOCK_SETTINGS };
  }

  async saveSettings(householdId: Uuid, settings: RestockSettings): Promise<void> {
    if (!isUuid(householdId)) throw new Error(`Household id must be a UUID (got "${householdId}")`);
    const res = (await this.client
      .from('restock_settings')
      .upsert({ household_id: householdId, auto_add: settings.autoAdd }, { onConflict: 'household_id' })) as PgResult<unknown>;
    unwrap('save restock_settings', res);
  }
}
