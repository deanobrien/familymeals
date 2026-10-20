import type { PurchaseEvent, Uuid } from '@fr/domain';
import type { PlacementTargetType, StoreBook } from '@fr/engine/shopping';
import type { Household, Recipe, ShoppingConflict, ShoppingListItem, UserSession } from '@/viewModels';

export interface ShoppingListState {
  items: ShoppingListItem[];
  /** Item ids whose tick has not yet been confirmed by the server (offline / in flight). */
  pendingItemIds: Uuid[];
}

/**
 * Boundary between UI and backend. `MockDataSource` (no env) and `SupabaseDataSource`
 * (EXPO_PUBLIC_SUPABASE_URL set) both implement it; screens never know which one they have.
 */
export interface DataSource {
  getSession(): Promise<UserSession | null>;
  signIn(email: string, password: string): Promise<UserSession>;
  signOut(): Promise<void>;
  /** Bearer token for the web app's server endpoints (recipe extraction). Null when signed out. */
  getAccessToken(): Promise<string | null>;

  listHouseholds(): Promise<Household[]>;
  listRecipes(householdId: Uuid): Promise<Recipe[]>;
  getRecipe(recipeId: Uuid): Promise<Recipe | null>;

  /** Loads (or resyncs from the command-log cursor) and returns the optimistic list view. */
  getShoppingList(householdId: Uuid): Promise<ShoppingListState>;
  /**
   * One-tap tick. Records an append-only PurchaseEvent with a client-generated id (idempotent replay).
   * The tick is optimistic; delivery to the server is queued if offline. Throws if nothing is left to buy.
   */
  tickItem(householdId: Uuid, itemId: Uuid): Promise<PurchaseEvent>;
  /** Voids the latest active purchase of an item (append-only undo; queued if offline). */
  undoTick(householdId: Uuid, itemId: Uuid): Promise<void>;
  /** Replay queued commands in order. Returns number delivered (acknowledged by the server). */
  flushPending(): Promise<number>;
  pendingCount(): number;
  /** Drain server rejections of this device's own commands (for toasts). */
  takeConflicts(): ShoppingConflict[];
  /** Stores, aisles and placements (AS1). Falls back to the on-device cache when the server cannot be reached. */
  getStoreBook?(householdId: Uuid): Promise<StoreBook>;
  /** Place an item's ingredient (or name) in a store aisle; `aisleId = null` clears it. Needs a connection. */
  setPlacement?(householdId: Uuid, storeId: Uuid, target: { targetType: PlacementTargetType; targetKey: string }, aisleId: Uuid | null): Promise<void>;
  /** The store this phone last shopped at (null = group by category). */
  getSelectedStoreId?(householdId: Uuid): Promise<string | null>;
  setSelectedStoreId?(householdId: Uuid, storeId: string | null): Promise<void>;
  /** Connectivity hint from NetInfo; when false the data source does not attempt to deliver. */
  setOnline?(online: boolean): void;
}
