// Supabase store locations (P2-A, D390-D392): `store_locations` as the signed-in user under RLS. Only the location a
// member saved for a store; there is no column for a live position (supabase/migrations/20261021002000).
import 'server-only';
import type { StoreLocation, LocationInputValue } from '../../stores/locations';
import { roundCoord } from '../../stores/locations';
import { StoreBookError } from '../stores/repository';
import type { StoreLocationRepository } from '../stores/locations';
import { SupabaseRepositoryError, unwrap, type SupabaseClient } from './rpc';

type Row = Record<string, unknown>;

const COLS = 'store_id, lat, lng, radius_m, source, postcode';

export function locationFromRow(r: Row): StoreLocation | null {
  const lat = Number(r.lat);
  const lng = Number(r.lng);
  if (typeof r.store_id !== 'string' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    storeId: r.store_id,
    lat,
    lng,
    radiusM: Number(r.radius_m) || 150,
    source: r.source === 'postcode' ? 'postcode' : 'device',
    postcode: typeof r.postcode === 'string' ? r.postcode : null,
  };
}

export class SupabaseStoreLocationRepository implements StoreLocationRepository {
  constructor(private readonly client: SupabaseClient, private readonly userId: string | null) {}

  async list(householdId: string): Promise<StoreLocation[]> {
    const rows = unwrap<Row[]>('listStoreLocations', await this.client.from('store_locations').select(COLS).eq('household_id', householdId).order('store_id') as never) ?? [];
    return rows.map(locationFromRow).filter((l): l is StoreLocation => l !== null);
  }

  async set(householdId: string, storeId: string, v: LocationInputValue): Promise<StoreLocation> {
    try {
      const row = unwrap<Row[]>('setStoreLocation', await this.client.from('store_locations').upsert(
        {
          store_id: storeId, household_id: householdId, lat: roundCoord(v.lat), lng: roundCoord(v.lng), radius_m: v.radiusM,
          source: v.source, postcode: v.postcode, created_by: this.userId, updated_at: new Date().toISOString(),
        },
        { onConflict: 'store_id' },
      ).select(COLS) as never)?.[0];
      const loc = row ? locationFromRow(row) : null;
      if (!loc) throw new StoreBookError('not_found', 'store not found');
      return loc;
    } catch (e) {
      // 23503 = no such store in this household (composite FK); 42501 = RLS refused (not a writable member)
      if (e instanceof SupabaseRepositoryError && e.code === '23503') throw new StoreBookError('not_found', 'store not found');
      throw e;
    }
  }

  async clear(householdId: string, storeId: string): Promise<void> {
    unwrap('clearStoreLocation', await this.client.from('store_locations').delete().eq('store_id', storeId).eq('household_id', householdId) as never);
  }

  reset(): void { /* nothing cached */ }
}
