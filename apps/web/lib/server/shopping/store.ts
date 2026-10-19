import 'server-only';
import { getIngredientCatalogue } from '../refdata/catalogue';
import { createSupabaseShoppingRepository, useSupabaseBackend } from '../supabase/backend';
import { getShoppingRepository, type ShoppingRepository } from './repository';

const KEY = Symbol.for('fr.shopping.store.supabase');

/**
 * The shopping repository for this process: Supabase (`SupabaseShoppingRepository`, signed-in user's client, D120)
 * when DATA_BACKEND=supabase is usable, else the in-memory demo repository. Decisions use the refdata catalogue
 * converter (density / unit weights) in both.
 */
export function getShoppingStore(): ShoppingRepository {
  if (!useSupabaseBackend()) return getShoppingRepository();
  const g = globalThis as unknown as Record<symbol, ShoppingRepository | undefined>;
  return (g[KEY] ??= createSupabaseShoppingRepository({ converter: getIngredientCatalogue().converter }));
}

/** True when the browser should subscribe to Supabase Realtime instead of polling (D122). */
export const shoppingUsesRealtime = (): boolean => useSupabaseBackend() && !!process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
