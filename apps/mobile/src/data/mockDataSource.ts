import type { NutrientValue, PurchaseEvent, Quantity, Uuid } from '@fr/domain';
import type { PlacementTargetType, StoreBook } from '@fr/engine/shopping';
import type { Recipe, ShoppingConflict, ShoppingListItem, UserSession } from '@/viewModels';
import { newId } from '@/lib/format';
import { MockAccountSource } from './mockAccountSource';
import type { DataSource, ShoppingListState } from './DataSource';

const q = (value: number, unit: Quantity['unit'], originalText: string): Quantity => ({
  kind: 'exact',
  value,
  unit,
  originalText,
});

const nut = (
  nutrient: NutrientValue['nutrient'],
  unit: NutrientValue['unit'],
  status: NutrientValue['status'],
  value?: number,
): NutrientValue => ({ nutrient, unit, status, value, estimate: false });

const RECIPES: Recipe[] = [
  {
    id: 'r-1',
    householdId: 'hh-1',
    title: 'Spaghetti Bolognese',
    servings: 4,
    dietCategory: 'meat',
    ingredients: [
      { id: 'i-1', name: 'Minced beef', quantity: q(500, 'g', '500g'), optional: false, order: 1 },
      { id: 'i-2', name: 'Onion', quantity: q(1, 'item', '1 onion'), preparation: 'finely chopped', optional: false, order: 2 },
      { id: 'i-3', name: 'Salt', quantity: { kind: 'to_taste', originalText: 'to taste' }, optional: false, order: 3 },
    ],
    steps: ['Brown the beef.', 'Add onion and simmer.', 'Serve over spaghetti.'],
    nutrition: [
      nut('energy_kcal', 'kcal', 'known', 520),
      nut('protein', 'g', 'known', 31),
      nut('fibre', 'g', 'unknown'),
      nut('salt', 'g', 'unavailable'),
    ],
  },
  {
    id: 'r-2',
    householdId: 'hh-1',
    title: 'Veg Chilli',
    servings: 6,
    dietCategory: 'vegan',
    ingredients: [
      { id: 'i-4', name: 'Kidney beans', quantity: q(2, 'can', '2 cans'), optional: false, order: 1 },
      {
        id: 'i-5',
        name: 'Chilli flakes',
        quantity: { kind: 'approximate', approxLabel: 'pinch', originalText: 'a pinch' },
        optional: true,
        order: 2,
      },
    ],
    steps: ['Combine everything.', 'Simmer 30 minutes.'],
    nutrition: [nut('energy_kcal', 'kcal', 'known', 310), nut('fat', 'g', 'zero')],
  },
  {
    id: 'r-3',
    householdId: 'hh-2',
    title: 'Cheese on Toast',
    servings: 1,
    ingredients: [{ id: 'i-6', name: 'Bread', quantity: q(2, 'slice', '2 slices'), optional: false, order: 1 }],
    steps: ['Grill.'],
    nutrition: [],
  },
];

const SHOPPING: ShoppingListItem[] = [
  { id: 's-1', householdId: 'hh-1', displayName: 'Minced beef', quantity: q(500, 'g', '500g'), aisle: 'Meat', ticked: false },
  { id: 's-2', householdId: 'hh-1', displayName: 'Onions', quantity: q(3, 'item', '3'), aisle: 'Veg', ticked: false },
  { id: 's-3', householdId: 'hh-1', displayName: 'Kidney beans', quantity: q(2, 'can', '2 cans'), aisle: 'Tins', ticked: false },
  { id: 's-4', householdId: 'hh-2', displayName: 'Bread', quantity: q(1, 'pack', '1 loaf'), aisle: 'Bakery', ticked: false },
];

/** Demo store for hh-1 (AS1): categories placed by category, aisle order differs from the alphabetical default. */
const DEMO_BOOK: StoreBook = {
  stores: [{ id: 'st-1', name: 'Demo Shop', chain: null, notes: null }],
  aisles: [
    { id: 'ai-1', storeId: 'st-1', label: '1', sortOrder: 10 },
    { id: 'ai-2', storeId: 'st-1', label: '2', sortOrder: 20 },
    { id: 'ai-3', storeId: 'st-1', label: '3', sortOrder: 30 },
  ],
  placements: [
    { storeId: 'st-1', targetType: 'category', targetKey: 'Veg', aisleId: 'ai-1' },
    { storeId: 'st-1', targetType: 'category', targetKey: 'Tins', aisleId: 'ai-2' },
    { storeId: 'st-1', targetType: 'category', targetKey: 'Meat', aisleId: 'ai-3' },
  ],
};

export interface MockOptions {
  latencyMs?: number;
  online?: boolean;
}

export class MockDataSource implements DataSource {
  readonly account = new MockAccountSource();
  private session: UserSession | null = null;
  private items: ShoppingListItem[] = SHOPPING.map((i) => ({ ...i }));
  private queue: PurchaseEvent[] = [];
  /** Simulated server-side idempotency set keyed by client event id. */
  private delivered = new Set<Uuid>();
  online: boolean;
  private latencyMs: number;

  constructor(opts: MockOptions = {}) {
    this.online = opts.online ?? true;
    this.latencyMs = opts.latencyMs ?? 0;
  }

  setOnline(online: boolean) {
    this.online = online;
  }

  /** Test helper: number of distinct events the "server" has accepted. */
  deliveredCount() {
    return this.delivered.size;
  }

  private async delay() {
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));
  }

  async getSession() {
    return this.session;
  }

  async signIn(email: string, password: string): Promise<UserSession> {
    await this.delay();
    if (!email.includes('@') || password.length < 6) throw new Error('Invalid email or password');
    this.session = { userId: 'user-1', email };
    return this.session;
  }

  async signOut() {
    this.session = null;
  }

  async getAccessToken() {
    return this.session ? 'mock-access-token' : null;
  }

  takeConflicts(): ShoppingConflict[] {
    return [];
  }

  async undoTick(householdId: Uuid, itemId: Uuid): Promise<void> {
    const item = this.items.find((i) => i.id === itemId && i.householdId === householdId);
    if (!item || !item.ticked) throw new Error('Nothing to undo for this item.');
    item.ticked = false;
    this.queue = this.queue.filter((e) => e.shoppingListItemId !== itemId);
  }

  async listHouseholds() {
    await this.delay();
    const memberships = await this.account.listMemberships();
    return Promise.all(
      memberships.map(async (m) => ({ id: m.id, name: m.name, memberCount: (await this.account.listMembers(m.id)).length })),
    );
  }

  async listRecipes(householdId: Uuid) {
    await this.delay();
    return RECIPES.filter((r) => r.householdId === householdId);
  }

  async getRecipe(recipeId: Uuid) {
    await this.delay();
    return RECIPES.find((r) => r.id === recipeId) ?? null;
  }

  private book: StoreBook = structuredClone(DEMO_BOOK);
  private selectedStore: string | null = null;

  async getStoreBook(householdId: Uuid): Promise<StoreBook> {
    await this.delay();
    return householdId === 'hh-1' ? structuredClone(this.book) : { stores: [], aisles: [], placements: [] };
  }

  async setPlacement(_h: Uuid, storeId: Uuid, target: { targetType: PlacementTargetType; targetKey: string }, aisleId: Uuid | null): Promise<void> {
    this.book.placements = this.book.placements.filter((p) => !(p.storeId === storeId && p.targetType === target.targetType && p.targetKey === target.targetKey));
    if (aisleId) this.book.placements.push({ storeId, aisleId, ...target });
  }

  async getSelectedStoreId(): Promise<string | null> {
    return this.selectedStore;
  }
  async setSelectedStoreId(_h: Uuid, storeId: string | null): Promise<void> {
    this.selectedStore = storeId;
  }

  async getShoppingList(householdId: Uuid): Promise<ShoppingListState> {
    await this.delay();
    const items = this.items.filter((i) => i.householdId === householdId).map((i) => ({ ...i, canUndo: i.ticked }));
    return { items, pendingItemIds: this.queue.map((e) => e.shoppingListItemId) };
  }

  async tickItem(householdId: Uuid, itemId: Uuid): Promise<PurchaseEvent> {
    const item = this.items.find((i) => i.id === itemId && i.householdId === householdId);
    if (!item) throw new Error('Item not found');
    item.ticked = true;
    const event: PurchaseEvent = {
      id: newId(),
      shoppingListItemId: itemId,
      quantity: item.quantity,
      createdBy: this.session?.userId ?? 'anonymous',
      createdAt: new Date().toISOString(),
    };
    this.queue.push(event);
    if (this.online) await this.flushPending();
    return event;
  }

  async flushPending(): Promise<number> {
    if (!this.online) return 0;
    let n = 0;
    for (const e of this.queue) {
      if (!this.delivered.has(e.id)) {
        this.delivered.add(e.id);
        n++;
      }
    }
    this.queue = [];
    return n;
  }

  pendingCount() {
    return this.queue.length;
  }
}
