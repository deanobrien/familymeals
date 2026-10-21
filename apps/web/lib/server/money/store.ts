import 'server-only';
import { createSupabaseMoneyRepository, useSupabaseBackend } from '../supabase/backend';
import { getStoreBook } from '../stores/store';
import { InMemoryMoneyRepository, type MoneyRepository } from './repository';

const MEM = Symbol.for('fr.money.repository.memory');
const SB = Symbol.for('fr.money.repository.supabase');
type G = Record<symbol, MoneyRepository | undefined>;

/** The money repository for this process: Supabase (signed-in user, RLS) when DATA_BACKEND=supabase is usable, else in-memory. */
export function getMoneyRepository(): MoneyRepository {
  const g = globalThis as unknown as G;
  if (useSupabaseBackend()) return (g[SB] ??= createSupabaseMoneyRepository());
  return (g[MEM] ??= new InMemoryMoneyRepository(undefined, async (h, id) => (await getStoreBook().book(h)).stores.some((s) => s.id === id)));
}

export function resetMoneyRepository(householdId?: string): void {
  (globalThis as unknown as G)[MEM]?.reset(householdId);
}
