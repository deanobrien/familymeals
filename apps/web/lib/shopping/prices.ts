import type { CanonicalIngredient, PriceKind, PriceObservation, Quantity } from '@fr/domain';
import { proportionalCost, rankObservations, matchingObservations } from '@fr/engine/cost';
import { createQuantityConverter } from '@fr/engine/units';
import type { ItemView } from './engine';

export type { PriceKind };

export const PRICE_KIND_LABEL: Record<PriceKind, string> = {
  user_confirmed: 'your price',
  receipt: 'from a receipt',
  retailer_verified: 'retailer price',
  generic_estimate: 'generic estimate',
};

/**
 * Prices the client needs to estimate the basket live while items are ticked (built server-side from the
 * shared price store: refdata generic estimates + this household's receipt observations, see D34).
 */
export interface PriceBook {
  observations: PriceObservation[];
  /** Ingredient data the converter needs (density / unit weight) for the priced ingredients. */
  ingredients: CanonicalIngredient[];
  /** `name:<normalised>` item key -> ingredient id, for items added by hand without an ingredient id. */
  nameIndex: Record<string, string>;
}

export const EMPTY_PRICE_BOOK: PriceBook = { observations: [], ingredients: [], nameIndex: {} };

export interface ItemCost {
  pence: number;
  kind: PriceKind;
}

function ingredientIdFor(view: ItemView, book: PriceBook): string | undefined {
  return view.item.ingredientId ?? book.nameIndex[view.item.key];
}

/** Estimated cost of what is still outstanding for one item (null when unpriced / not convertible). */
export function estimateItemCost(view: ItemView, book: PriceBook, converter = converterFor(book)): ItemCost | null {
  if (view.outstanding <= 0) return null;
  const id = ingredientIdFor(view, book);
  if (!id) return null;
  if (!view.quantified) {
    // Unquantified ("salt, to taste"): one pack at the best available price.
    const best = rankObservations(matchingObservations(book.observations, { ingredientId: id }))[0];
    return best ? { pence: best.pricePence, kind: best.kind } : null;
  }
  const need: Quantity = { kind: 'exact', value: view.outstanding, originalText: '', ...(view.unit ? { unit: view.unit } : {}) };
  const ingredients = new Map(book.ingredients.map((i) => [i.id, i]));
  const r = proportionalCost(need, id, { prices: book.observations, converter, ingredients: (x) => ingredients.get(x) });
  return 'costPence' in r ? { pence: r.costPence, kind: r.price.kind } : null;
}

export function converterFor(book: PriceBook) {
  const byId = new Map(book.ingredients.map((i) => [i.id, i]));
  return createQuantityConverter((id) => byId.get(id));
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

/** Basket estimate via `@fr/engine/cost` (price hierarchy: your price > receipt > retailer > generic). */
export function estimateBasket(views: ItemView[], book: PriceBook): BasketEstimate {
  const out: BasketEstimate = { totalPence: 0, pricedCount: 0, unpricedCount: 0, weakestKind: null, byItem: {} };
  const converter = converterFor(book);
  for (const v of views) {
    if (v.outstanding <= 0 || v.noLongerNeeded || v.item.removed) continue;
    const cost = estimateItemCost(v, book, converter);
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
