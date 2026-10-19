import type { PurchaseEvent, Uuid } from '@fr/domain';
import type { Household, Recipe, ShoppingListItem, UserSession } from '@/viewModels';

export interface ShoppingListState {
  items: ShoppingListItem[];
  /** Item ids whose tick has not yet been confirmed by the server (offline / in flight). */
  pendingItemIds: Uuid[];
}

/**
 * Boundary between UI and backend. The mock implements it today; a SupabaseDataSource
 * (supabase-js + RLS) drops in with no screen changes.
 */
export interface DataSource {
  getSession(): Promise<UserSession | null>;
  signIn(email: string, password: string): Promise<UserSession>;
  signOut(): Promise<void>;

  listHouseholds(): Promise<Household[]>;
  listRecipes(householdId: Uuid): Promise<Recipe[]>;
  getRecipe(recipeId: Uuid): Promise<Recipe | null>;

  getShoppingList(householdId: Uuid): Promise<ShoppingListState>;
  /**
   * One-tap tick. Records an append-only PurchaseEvent with a client-generated id (idempotent replay).
   * The tick is optimistic; delivery to the server is queued if offline.
   */
  tickItem(householdId: Uuid, itemId: Uuid): Promise<PurchaseEvent>;
  /** Replay queued events. Returns number delivered. */
  flushPending(): Promise<number>;
  pendingCount(): number;
}
