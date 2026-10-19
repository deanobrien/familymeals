import type { NutrientValue, PurchaseEvent, Quantity, Uuid } from '@fr/domain';
import type { Household, Recipe, ShoppingConflict, ShoppingListItem, UserSession } from '@/viewModels';
import { newId } from '@/lib/format';
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

const HOUSEHOLDS: Household[] = [
  { id: 'hh-1', name: 'The Smiths', memberCount: 4 },
  { id: 'hh-2', name: 'Flat 3B', memberCount: 2 },
];

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

export interface MockOptions {
  latencyMs?: number;
  online?: boolean;
}

export class MockDataSource implements DataSource {
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
    return HOUSEHOLDS.map((h) => ({ ...h }));
  }

  async listRecipes(householdId: Uuid) {
    await this.delay();
    return RECIPES.filter((r) => r.householdId === householdId);
  }

  async getRecipe(recipeId: Uuid) {
    await this.delay();
    return RECIPES.find((r) => r.id === recipeId) ?? null;
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
