import { createHash } from 'node:crypto';
import type { CanonicalIngredient, PriceObservation, PurchaseEvent } from '@fr/domain';
import { deriveAll, type EngineContext } from '@fr/engine/shopping';
import type { OutstandingItem } from '../../receipts/matcher';
import type { PriceStore } from '../prices/store';
import type { ShoppingRepository } from '../shopping/repository';
import type { OutstandingItemsSource, PantryEntry, PurchaseSink } from './ports';

/**
 * Receipts <-> shopping list (DECISIONS D34). Outstanding items are read from the household's shopping list;
 * confirmed receipt lines become purchase commands on that list (so they tick items on /shopping), and line
 * prices become `receipt` price observations in the shared price store (which the basket estimate prefers
 * over generic estimates).
 */
export class ShoppingOutstandingSource implements OutstandingItemsSource {
  constructor(
    private readonly repo: ShoppingRepository,
    private readonly ctx: EngineContext,
    private readonly ingredient: (id: string) => CanonicalIngredient | undefined,
    /**
     * Exact name/alias lookup for list items that carry no canonical id (a hand-typed recipe line, a manual add). Without
     * it such an item can never receive a receipt price observation, so a household's own receipts would not change
     * its recipe costs (found by the live suite, LT1 D231). Never guesses: only an exact catalogue match counts.
     */
    private readonly resolveName?: (name: string) => string | undefined,
  ) {}

  async list(householdId: string): Promise<OutstandingItem[]> {
    const { state } = await this.repo.snapshot(householdId);
    return deriveAll(state, this.ctx)
      .filter((v) => !v.item.removed && !v.noLongerNeeded && v.outstanding > 0)
      .map((v) => {
        const ingredientId = v.item.ingredientId ?? this.resolveName?.(v.item.displayName);
        const ing = ingredientId ? this.ingredient(ingredientId) : undefined;
        return {
          shoppingListItemId: v.item.id,
          name: (ing?.name ?? v.item.displayName).toLowerCase(),
          aliases: ing ? [...ing.aliases, v.item.displayName.toLowerCase()] : [],
          ...(ingredientId ? { ingredientId } : {}),
          ...(ing?.form ? { form: ing.form } : {}),
          ...(v.quantified
            ? { outstanding: { kind: 'exact' as const, value: v.outstanding, originalText: '', ...(v.unit ? { unit: v.unit } : {}) } }
            : {}),
        };
      });
  }
}

/** Deterministic UUID-shaped id derived from another id (idempotent fallback commands). */
function derivedId(seed: string, salt: string): string {
  const h = createHash('sha1').update(`${salt}:${seed}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export class ShoppingPurchaseSink implements PurchaseSink {
  constructor(
    private readonly householdId: string,
    private readonly repo: ShoppingRepository,
    private readonly prices: PriceStore,
    private readonly pantry: { addToPantry(entries: PantryEntry[]): Promise<void> },
  ) {}

  async recordPurchases(events: PurchaseEvent[]): Promise<void> {
    for (const e of events) {
      const base = { commandId: e.id, actor: e.createdBy, at: e.createdAt, itemId: e.shoppingListItemId };
      const out = await this.repo.submit(this.householdId, {
        type: 'purchase', ...base, quantity: e.quantity,
        ...(e.actualPricePence !== undefined ? { actualPricePence: e.actualPricePence } : {}),
        ...(e.receiptLineId ? { receiptLineId: e.receiptLineId } : {}),
      });
      // A receipt quantity in a unit the list cannot compare (e.g. "1 kg" against "4 onions"): the user
      // confirmed the line, so count the item as bought in full.
      if (out.result.status === 'rejected' && out.result.reason === 'incompatible_unit') {
        await this.repo.submit(this.householdId, { type: 'tick', ...base, commandId: derivedId(e.id, 'tick') });
      }
    }
  }

  async recordPriceObservations(observations: PriceObservation[]): Promise<void> {
    await this.prices.record(this.householdId, observations);
  }

  async addToPantry(entries: PantryEntry[]): Promise<void> {
    await this.pantry.addToPantry(entries);
  }
}
