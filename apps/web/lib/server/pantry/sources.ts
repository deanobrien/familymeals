import recipeData from './data/recipes.json';
import type {
  CookedBatch, OpenSlot, PantryItem, PurchaseEvent, PurchaseTarget, RecipeSummary, Uuid,
} from '../../pantry/engine';
import { addDays, exactQ, today } from '../../pantry/engine';
import type { IngredientLookup } from './ingredients';

/* ---------- Recipes ("Use what I have") ---------- */

/** Read-only recipe feed. The recipes lane will provide the real implementation. */
export interface RecipeSummarySource {
  list(householdId: Uuid): Promise<RecipeSummary[]>;
}

export class InMemoryRecipeSummarySource implements RecipeSummarySource {
  constructor(private readonly recipes: readonly RecipeSummary[] = recipeData as RecipeSummary[]) {}
  async list(): Promise<RecipeSummary[]> {
    return structuredClone([...this.recipes]);
  }
}

/* ---------- Purchases (post-purchase pantry adjustments) ---------- */

export interface PurchaseRecord {
  event: PurchaseEvent;
  target: PurchaseTarget;
}

/** Feed of recorded purchases from the shopping lane (append-only PurchaseEvents + what they were for). */
export interface PurchaseEventSource {
  list(householdId: Uuid): Promise<PurchaseRecord[]>;
}

export class InMemoryPurchaseEventSource implements PurchaseEventSource {
  constructor(private readonly records: readonly PurchaseRecord[]) {}
  async list(householdId: Uuid): Promise<PurchaseRecord[]> {
    return structuredClone(this.records.filter((r) => r.target.householdId === householdId));
  }
}

/** Fixture purchases: two exact, one approximate/unmatched, one voided. Event ids are stable. */
export function fixturePurchaseRecords(householdId: Uuid, now: string, ingredients: IngredientLookup): PurchaseRecord[] {
  const user = 'a1a1a102-0000-4000-8000-000000000001';
  const at = `${addDays(today(now), -1)}T17:30:00.000Z`;
  const rec = (n: number, name: string, ing: string | undefined, quantity: PurchaseEvent['quantity'], voided = false): PurchaseRecord => {
    const hit = ing ? ingredients.findByName(ing) : undefined;
    return {
      event: {
        id: `e0e0e000-0000-4000-8000-00000000000${n}`, shoppingListItemId: `5151a000-0000-4000-8000-00000000000${n}`,
        quantity, createdBy: user, createdAt: at, ...(voided ? { voidedBy: user } : {}),
      },
      target: { householdId, name, ...(hit ? { ingredientId: hit.id } : {}) },
    };
  };
  return [
    rec(1, 'Chicken breast', 'chicken breast', exactQ(600, 'g')),
    rec(2, 'Basmati rice', 'basmati rice', exactQ(1, 'kg')),
    rec(3, 'Mixed salad bag', undefined, { kind: 'approximate', unit: 'pack', approxLabel: 'bag', originalText: 'a bag' }),
    rec(4, 'Cheddar', 'cheddar', exactQ(400, 'g'), true),
  ];
}

/* ---------- Leftovers / batch cooking ---------- */

export interface LeftoverSource {
  listBatches(householdId: Uuid): Promise<CookedBatch[]>;
  /** Unfilled meal-plan slots (the planner lane will provide the real data). */
  listOpenSlots(householdId: Uuid): Promise<OpenSlot[]>;
}

export class InMemoryLeftoverSource implements LeftoverSource {
  constructor(private readonly now: () => string) {}
  async listBatches(): Promise<CookedBatch[]> {
    const t = today(this.now());
    return [
      { recipeId: 'fx-03-beef-stew-two-page', recipeTitle: 'Slow Winter Beef Stew', cookedOn: addDays(t, -1), portionsCooked: 6, portionsEaten: 2, keepDays: 3 },
      { recipeId: 'fx-06-fish-pie', recipeTitle: 'Family Fish Pie', cookedOn: t, portionsCooked: 4, portionsEaten: 3, keepDays: 2, freezable: true },
    ];
  }
  async listOpenSlots(): Promise<OpenSlot[]> {
    const t = today(this.now());
    const slots: OpenSlot[] = [];
    for (let d = 0; d < 6; d++) {
      for (const mealType of ['lunch', 'dinner'] as const) {
        slots.push({ id: `51075000-0000-4000-8000-${String(d * 2 + (mealType === 'lunch' ? 0 : 1)).padStart(12, '0')}`, date: addDays(t, d), mealType });
      }
    }
    return slots;
  }
}

/* ---------- Seed pantry stock ---------- */

/** Demo stock for household A, dated relative to `now` so expiry/stale states are always showing. */
export function seedPantryItems(householdId: Uuid, now: string, ingredients: IngredientLookup): PantryItem[] {
  const t = today(now);
  const daysAgo = (n: number) => `${addDays(t, -n)}T09:00:00.000Z`;
  const specs: { name: string; q: PantryItem['quantity']; expiry?: number; ageDays: number }[] = [
    { name: 'onion', q: exactQ(3, 'item'), expiry: 14, ageDays: 2 },
    { name: 'potato', q: exactQ(1500, 'g'), ageDays: 3 },
    { name: 'egg', q: exactQ(6, 'item'), expiry: 1, ageDays: 3 },
    { name: 'milk', q: exactQ(500, 'ml'), expiry: -1, ageDays: 5 },
    { name: 'cheddar', q: exactQ(200, 'g'), expiry: 3, ageDays: 4 },
    { name: 'butter', q: exactQ(250, 'g'), expiry: 30, ageDays: 6 },
    { name: 'plain flour', q: exactQ(1000, 'g'), ageDays: 4 },
    { name: 'frozen peas', q: exactQ(500, 'g'), expiry: 120, ageDays: 5 },
    { name: 'pasta', q: exactQ(500, 'g'), ageDays: 6 },
    { name: 'tinned tomatoes', q: exactQ(2, 'can'), ageDays: 6 },
    { name: 'rolled oats', q: exactQ(600, 'g'), ageDays: 8 },
    { name: 'garlic clove', q: exactQ(6, 'clove'), expiry: 10, ageDays: 2 },
    { name: 'lemon', q: exactQ(2, 'item'), ageDays: 20 },
    { name: 'carrot', q: exactQ(4, 'item'), expiry: 5, ageDays: 21 },
  ];
  const out: PantryItem[] = [];
  specs.forEach((s, i) => {
    const ing = ingredients.findByName(s.name);
    if (!ing) throw new Error(`Seed ingredient not found in refdata: ${s.name}`);
    out.push({
      id: `9a97b000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      householdId, ingredientId: ing.id, name: ing.name, quantity: s.q,
      ...(s.expiry !== undefined ? { expiry: addDays(t, s.expiry) } : {}),
      lastUpdated: daysAgo(s.ageDays), source: 'manual',
    });
  });
  return out;
}
