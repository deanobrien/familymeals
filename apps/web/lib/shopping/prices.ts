import type { ItemView, Unit } from './engine';
import { defaultEngineContext, valueIn } from './engine';

/** Mirrors the contract's PriceKind (priority order). TODO: import from @fr/domain once merged. */
export type PriceKind = 'user_confirmed' | 'receipt' | 'retailer_verified' | 'generic_estimate';

export interface UnitPrice {
  /** Pence for `per` of `unit`, e.g. 550p per 1 kg. */
  pence: number;
  per: number;
  unit: Unit;
  kind: PriceKind;
}

export const PRICE_KIND_LABEL: Record<PriceKind, string> = {
  user_confirmed: 'your price',
  receipt: 'from a receipt',
  retailer_verified: 'retailer price',
  generic_estimate: 'generic estimate',
};

/** Looks up a price for a shopping item. Placeholder for @fr/engine cost + price observations. */
export type PriceLookup = (itemKey: string, ingredientId?: string) => UnitPrice | undefined;

/**
 * Generic-estimate fixture prices keyed by ingredient id or normalised name.
 * TODO: replace with @fr/engine/cost fed by @fr/refdata price seeds + household observations.
 */
const FIXTURE: Record<string, UnitPrice> = {
  'ing:ing-onion': { pence: 15, per: 1, unit: 'item', kind: 'generic_estimate' },
  'ing:ing-chicken-breast': { pence: 650, per: 1, unit: 'kg', kind: 'generic_estimate' },
  'ing:ing-beef-mince': { pence: 590, per: 1, unit: 'kg', kind: 'generic_estimate' },
  'ing:ing-chopped-tomatoes': { pence: 70, per: 1, unit: 'can', kind: 'generic_estimate' },
  'ing:ing-spaghetti': { pence: 180, per: 1, unit: 'kg', kind: 'generic_estimate' },
  'ing:ing-double-cream': { pence: 120, per: 300, unit: 'ml', kind: 'generic_estimate' },
  'ing:ing-garlic': { pence: 8, per: 1, unit: 'clove', kind: 'generic_estimate' },
  'ing:ing-garam-masala': { pence: 5, per: 1, unit: 'tsp', kind: 'generic_estimate' },
  'ing:ing-basmati': { pence: 240, per: 1, unit: 'kg', kind: 'generic_estimate' },
  'ing:ing-cheddar': { pence: 900, per: 1, unit: 'kg', kind: 'generic_estimate' },
  'name:milk': { pence: 145, per: 2, unit: 'pint', kind: 'generic_estimate' },
  'name:bread': { pence: 120, per: 1, unit: 'item', kind: 'generic_estimate' },
  'name:eggs': { pence: 30, per: 1, unit: 'item', kind: 'generic_estimate' },
  'name:bananas': { pence: 12, per: 1, unit: 'item', kind: 'generic_estimate' },
};

export const fixturePriceLookup: PriceLookup = (itemKey) => FIXTURE[itemKey];

export interface ItemCost {
  pence: number;
  kind: PriceKind;
}

/** Estimated cost of what is still outstanding for one item (null when unpriced / not convertible). */
export function estimateItemCost(view: ItemView, price: UnitPrice | undefined): ItemCost | null {
  if (!price || view.outstanding <= 0) return null;
  const unit = view.unit ?? 'item';
  const qty = view.quantified
    ? valueIn({ kind: 'exact', value: view.outstanding, unit, originalText: '' }, price.unit, defaultEngineContext)
    : 1; // unquantified ("salt, to taste"): one purchase
  if (qty === null) return null;
  return { pence: Math.round((qty / price.per) * price.pence), kind: price.kind };
}

export interface BasketEstimate {
  totalPence: number;
  pricedCount: number;
  unpricedCount: number;
  /** Weakest price quality used (generic_estimate is the weakest): drives the "est." label. */
  weakestKind: PriceKind | null;
  byItem: Record<string, ItemCost>;
}

const ORDER: PriceKind[] = ['generic_estimate', 'retailer_verified', 'receipt', 'user_confirmed'];

export function estimateBasket(views: ItemView[], lookup: PriceLookup = fixturePriceLookup): BasketEstimate {
  const out: BasketEstimate = { totalPence: 0, pricedCount: 0, unpricedCount: 0, weakestKind: null, byItem: {} };
  for (const v of views) {
    if (v.outstanding <= 0 || v.noLongerNeeded || v.item.removed) continue;
    const cost = estimateItemCost(v, lookup(v.item.key, v.item.ingredientId));
    if (!cost) {
      out.unpricedCount++;
      continue;
    }
    out.byItem[v.item.id] = cost;
    out.totalPence += cost.pence;
    out.pricedCount++;
    if (out.weakestKind === null || ORDER.indexOf(cost.kind) < ORDER.indexOf(out.weakestKind)) out.weakestKind = cost.kind;
  }
  return out;
}
