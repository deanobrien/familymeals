import 'server-only';
import { createSupabaseStoreBookRepository, useSupabaseBackend } from '../supabase/backend';
import { getMemoryStoreBook, type StoreBookRepository } from './repository';

const KEY = Symbol.for('fr.stores.repository.supabase');

/** The store book for this process: Supabase (signed-in user's client, RLS) when DATA_BACKEND=supabase is usable, else in-memory. */
export function getStoreBook(): StoreBookRepository {
  if (!useSupabaseBackend()) return getMemoryStoreBook();
  const g = globalThis as unknown as Record<symbol, StoreBookRepository | undefined>;
  return (g[KEY] ??= createSupabaseStoreBookRepository());
}
