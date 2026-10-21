// Supabase money repository (P2-B, D400): spend_entries and store_retailer_links as the signed-in user under RLS (any member
// of a writable household writes). Plain table access like the store book (D293).
import 'server-only';
import type { ManualSpend, SpendInput } from '../../money/types';
import { MoneyError, type MoneyRepository } from '../money/repository';
import { SupabaseRepositoryError, unwrap, type SupabaseClient } from './rpc';

type Row = Record<string, unknown>;
const COLS = 'id, spent_on, amount_pence, store_id, retailer, category, note';

export function spendFromRow(r: Row): ManualSpend {
  return {
    id: String(r.id), date: String(r.spent_on).slice(0, 10), amountPence: Number(r.amount_pence),
    storeId: typeof r.store_id === 'string' ? r.store_id : null, retailer: typeof r.retailer === 'string' ? r.retailer : null,
    category: typeof r.category === 'string' ? r.category : null, note: typeof r.note === 'string' ? r.note : null,
  };
}

function map(e: unknown): never {
  if (e instanceof SupabaseRepositoryError && (e.code === '23503' || e.code === '23514' || e.code === '22023')) throw new MoneyError('invalid', 'That does not belong together.');
  throw e;
}

export class SupabaseMoneyRepository implements MoneyRepository {
  constructor(private readonly client: SupabaseClient, private readonly userId: string | null) {}

  async listSpend(householdId: string, from: string, to: string): Promise<ManualSpend[]> {
    const rows = unwrap<Row[]>('listSpend', await this.client.from('spend_entries').select(COLS).eq('household_id', householdId)
      .gte('spent_on', from).lte('spent_on', to).order('spent_on', { ascending: false }).order('id') as never) ?? [];
    return rows.map(spendFromRow);
  }

  private fields(i: SpendInput): Row {
    return { spent_on: i.date, amount_pence: i.amountPence, store_id: i.storeId ?? null, retailer: i.retailer ?? null, category: i.category ?? null, note: i.note ?? null };
  }

  async addSpend(householdId: string, input: SpendInput): Promise<ManualSpend> {
    try {
      const row = unwrap<Row[]>('addSpend', await this.client.from('spend_entries')
        .insert({ household_id: householdId, created_by: this.userId, ...this.fields(input) }).select(COLS) as never)?.[0];
      if (!row) throw new MoneyError('invalid', 'The entry could not be saved.');
      return spendFromRow(row);
    } catch (e) { return map(e); }
  }

  async updateSpend(householdId: string, id: string, input: SpendInput): Promise<ManualSpend> {
    try {
      const rows = unwrap<Row[]>('updateSpend', await this.client.from('spend_entries').update(this.fields(input))
        .eq('id', id).eq('household_id', householdId).select(COLS) as never) ?? [];
      if (!rows[0]) throw new MoneyError('not_found', 'That entry was not found.');
      return spendFromRow(rows[0]);
    } catch (e) { return map(e); }
  }

  async deleteSpend(householdId: string, id: string): Promise<void> {
    unwrap('deleteSpend', await this.client.from('spend_entries').delete().eq('id', id).eq('household_id', householdId) as never);
  }

  async links(householdId: string): Promise<Record<string, string>> {
    const rows = unwrap<Row[]>('links', await this.client.from('store_retailer_links').select('retailer_key, store_id').eq('household_id', householdId) as never) ?? [];
    return Object.fromEntries(rows.map((r) => [String(r.retailer_key), String(r.store_id)]));
  }

  async setLink(householdId: string, retailerKey: string, storeId: string | null): Promise<void> {
    if (!retailerKey) throw new MoneyError('invalid', 'No retailer to link.');
    try {
      if (storeId === null) {
        unwrap('setLink', await this.client.from('store_retailer_links').delete().eq('household_id', householdId).eq('retailer_key', retailerKey) as never);
        return;
      }
      unwrap('setLink', await this.client.from('store_retailer_links')
        .upsert({ household_id: householdId, retailer_key: retailerKey, store_id: storeId, created_by: this.userId }, { onConflict: 'household_id,retailer_key' }) as never);
    } catch (e) { map(e); }
  }

  reset(): void {
    /* nothing to reset: the database owns the data */
  }
}
