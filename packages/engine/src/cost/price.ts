import type { PriceKind, PriceObservation, Uuid } from '../contract';
import type { PriceChoice } from './types';

export const PRICE_KIND_RANK: Record<PriceKind, number> = {
  user_confirmed: 0, receipt: 1, retailer_verified: 2, generic_estimate: 3,
};

export function toChoice(o: PriceObservation): PriceChoice {
  return {
    pricePence: o.pricePence, packQuantity: o.packQuantity, kind: o.kind, source: o.source,
    observedOn: o.observedOn, isEstimate: o.kind === 'generic_estimate',
    ...(o.productPackId !== undefined ? { productPackId: o.productPackId } : {}),
    ...(o.retailer !== undefined ? { retailer: o.retailer } : {}),
  };
}

/** Deterministic ranking: kind hierarchy, then most recent observedOn, then lowest price, then source. */
export function rankObservations(obs: readonly PriceObservation[]): PriceObservation[] {
  return [...obs].sort((a, b) =>
    PRICE_KIND_RANK[a.kind] - PRICE_KIND_RANK[b.kind]
    || (a.observedOn < b.observedOn ? 1 : a.observedOn > b.observedOn ? -1 : 0)
    || a.pricePence - b.pricePence
    || (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
}

export interface PriceQuery { ingredientId?: Uuid; productPackId?: Uuid; asOf?: string; }

/** Observations relevant to a query (invalid prices and observations dated after asOf are ignored). */
export function matchingObservations(obs: readonly PriceObservation[], q: PriceQuery): PriceObservation[] {
  return obs.filter(o =>
    Number.isInteger(o.pricePence) && o.pricePence >= 0 &&
    (q.asOf === undefined || o.observedOn <= q.asOf) &&
    (q.productPackId !== undefined
      ? o.productPackId === q.productPackId
      : q.ingredientId !== undefined && o.ingredientId === q.ingredientId && o.productPackId === undefined));
}

/** Best price by hierarchy user_confirmed > receipt > retailer_verified > generic_estimate, then recency. */
export function selectPrice(obs: readonly PriceObservation[], q: PriceQuery): PriceChoice | null {
  const best = rankObservations(matchingObservations(obs, q))[0];
  return best ? toChoice(best) : null;
}
