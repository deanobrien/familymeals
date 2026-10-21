import 'server-only';
import { createSupabaseStoreLocationRepository, useSupabaseBackend } from '../supabase/backend';
import { InMemoryStoreLocationRepository, type StoreLocationRepository } from './locations';
import { getMemoryStoreBook } from './repository';

const MEM = Symbol.for('fr.stores.locations.memory');
const SUPA = Symbol.for('fr.stores.locations.supabase');

/** Saved store locations for this process: Supabase (signed-in user's client, RLS) when usable, else in-memory. */
export function getStoreLocations(): StoreLocationRepository {
  const g = globalThis as unknown as Record<symbol, StoreLocationRepository | undefined>;
  if (!useSupabaseBackend()) {
    return (g[MEM] ??= new InMemoryStoreLocationRepository(async (h, id) => (await getMemoryStoreBook().book(h)).stores.some((s) => s.id === id)));
  }
  return (g[SUPA] ??= createSupabaseStoreLocationRepository());
}
