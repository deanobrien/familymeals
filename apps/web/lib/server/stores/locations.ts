// Store locations (P2-A, D390-D392): one saved point + radius per store. One interface, an in-memory implementation (mock
// mode / tests) and a Supabase one (../supabase/store-location-repository.ts). Only the SAVED location lives here; no live
// position is ever passed to, or stored by, anything in this module.
import type { StoreLocation, LocationInputValue } from '../../stores/locations';
import { roundCoord } from '../../stores/locations';
import { StoreBookError } from './repository';

export interface StoreLocationRepository {
  list(householdId: string): Promise<StoreLocation[]>;
  /** Save (create or replace) a store's location. Throws StoreBookError('not_found') for a store of another household. */
  set(householdId: string, storeId: string, value: LocationInputValue): Promise<StoreLocation>;
  /** Forget a store's location (no error when it has none). */
  clear(householdId: string, storeId: string): Promise<void>;
  reset(householdId?: string): void;
}

/** In-memory implementation keyed by household. `storeExists` ties it to the store book (a deleted store drops its location). */
export class InMemoryStoreLocationRepository implements StoreLocationRepository {
  private readonly rows = new Map<string, Map<string, StoreLocation>>();
  constructor(private readonly storeExists: (householdId: string, storeId: string) => Promise<boolean>) {}

  private slot(h: string): Map<string, StoreLocation> {
    let s = this.rows.get(h);
    if (!s) this.rows.set(h, (s = new Map()));
    return s;
  }

  async list(h: string): Promise<StoreLocation[]> {
    const out: StoreLocation[] = [];
    for (const [storeId, loc] of this.slot(h)) {
      if (await this.storeExists(h, storeId)) out.push({ ...loc });
      else this.slot(h).delete(storeId); // the store was deleted: its location goes with it (as the FK cascade does)
    }
    return out.sort((a, b) => a.storeId.localeCompare(b.storeId));
  }

  async set(h: string, storeId: string, v: LocationInputValue): Promise<StoreLocation> {
    if (!(await this.storeExists(h, storeId))) throw new StoreBookError('not_found', 'store not found');
    const loc: StoreLocation = { storeId, lat: roundCoord(v.lat), lng: roundCoord(v.lng), radiusM: v.radiusM, source: v.source, postcode: v.postcode };
    this.slot(h).set(storeId, loc);
    return { ...loc };
  }

  async clear(h: string, storeId: string): Promise<void> {
    this.slot(h).delete(storeId);
  }

  reset(h?: string): void {
    if (h) this.rows.delete(h);
    else this.rows.clear();
  }
}
