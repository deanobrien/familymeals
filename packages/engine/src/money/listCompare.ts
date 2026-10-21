import type { CanonicalIngredient, PriceObservation, Quantity, Unit } from '../contract';
import { proportionalCost } from '../cost/recipeCost';
import { createQuantityConverter } from '../units/index';
import { compareIngredient, shopObservations, type IngredientComparison, type ShopRef, type ShopResolver } from './compare';
import { ageLabel, daysBetween } from './time';

/**
 * "Where's cheapest for this list?" (P2-B, D402). For each shop, the cost of the list items that HAVE a price at that
 * shop, with how many items that covers. Coverage is always shown: a shop with a price for 3 of 12 items is never
 * presented as a total for the list. A like-for-like row totals only the items priced at every compared shop, which is
 * the only honest way to say which shop is cheaper.
 */
export interface ListNeed {
  id: string;
  name: string;
  /** Canonical ingredient, already resolved by the caller (id, else exact catalogue name). */
  ingredientId?: string | undefined;
  /** Amount still to buy, in `unit`; ignored when not quantified (then one pack is costed). */
  outstanding: number;
  unit?: Unit | undefined;
  quantified: boolean;
}

export interface ShopTotal {
  shop: ShopRef;
  totalPence: number;
  pricedItems: number;
  /** Outstanding list items with no price at this shop (names, for "not counted"). */
  missing: string[];
  coveragePct: number;
  /** Age in days of the oldest price used. */
  oldestDays: number;
  oldestText: string;
  /** Every price used is recent (<= recentDays). */
  allRecent: boolean;
}

export interface LikeForLike { itemIds: string[]; itemNames: string[]; totals: { shop: ShopRef; totalPence: number }[]; cheapest: ShopRef | null }

export interface ListComparison {
  totalItems: number;
  /** Items the comparison could look at (resolved to an ingredient). */
  resolvedItems: number;
  shops: ShopTotal[];
  likeForLike: LikeForLike | null;
  /** Per list item: its "cheapest at" call (only items that have one). */
  byItem: Record<string, { ingredientId: string; comparison: IngredientComparison }>;
  note: string;
}

export interface ListCompareInput {
  needs: readonly ListNeed[];
  observations: readonly PriceObservation[];
  ingredients: readonly CanonicalIngredient[];
  resolve: ShopResolver;
  today: string;
  recentDays?: number;
}

const needQuantity = (n: ListNeed): Quantity => ({ kind: 'exact', value: n.outstanding, originalText: '', ...(n.unit ? { unit: n.unit } : {}) });

export function compareList(input: ListCompareInput): ListComparison {
  const { needs, observations, resolve, today } = input;
  const recentDays = input.recentDays ?? 60;
  const ingredientById = new Map(input.ingredients.map((i) => [i.id, i]));
  const converter = createQuantityConverter((id) => ingredientById.get(id));
  const live = needs.filter((n) => n.outstanding > 0 || !n.quantified);

  // per ingredient: the latest observation per shop (the price that shop would charge today, as far as we know)
  const ids = [...new Set(live.flatMap((n) => (n.ingredientId ? [n.ingredientId] : [])))];
  const latestByShop = new Map<string, Map<string, PriceObservation>>(); // shopKey -> ingredientId -> observation
  const shopRefs = new Map<string, ShopRef>();
  const byItem: ListComparison['byItem'] = {};
  for (const id of ids) {
    const comparison = compareIngredient(observations, id, resolve, { today, recentDays });
    if (comparison.cheapest) for (const n of live) if (n.ingredientId === id) byItem[n.id] = { ingredientId: id, comparison };
    const { obs } = shopObservations(observations, id, resolve);
    const seen = new Set<string>();
    for (const o of obs) {
      if (seen.has(o.shop.key)) continue;
      seen.add(o.shop.key);
      shopRefs.set(o.shop.key, o.shop);
      const m = latestByShop.get(o.shop.key) ?? new Map<string, PriceObservation>();
      m.set(id, o.raw);
      latestByShop.set(o.shop.key, m);
    }
  }

  const priceAt = (shopKey: string, n: ListNeed): { pence: number; ageDays: number } | null => {
    const obs = n.ingredientId ? latestByShop.get(shopKey)?.get(n.ingredientId) : undefined;
    if (!obs || !n.ingredientId) return null;
    const ageDays = Math.max(0, daysBetween(obs.observedOn, today));
    if (!n.quantified) return { pence: obs.pricePence, ageDays }; // unquantified: one pack
    const r = proportionalCost(needQuantity(n), n.ingredientId, { prices: [obs], converter, ingredients: (x) => ingredientById.get(x) });
    return 'costPence' in r ? { pence: r.costPence, ageDays } : null;
  };

  const shops: ShopTotal[] = [];
  const pricedBy = new Map<string, Map<string, number>>(); // shopKey -> need id -> pence
  for (const [key, ref] of shopRefs) {
    let total = 0;
    let priced = 0;
    let oldest = 0;
    const missing: string[] = [];
    const m = new Map<string, number>();
    for (const n of live) {
      const p = priceAt(key, n);
      if (!p) { missing.push(n.name); continue; }
      total += p.pence; priced++; oldest = Math.max(oldest, p.ageDays); m.set(n.id, p.pence);
    }
    if (priced === 0) continue;
    pricedBy.set(key, m);
    shops.push({ shop: ref, totalPence: total, pricedItems: priced, missing, coveragePct: live.length ? Math.round((priced / live.length) * 100) : 0, oldestDays: oldest, oldestText: ageLabel(oldest), allRecent: oldest <= recentDays });
  }
  // most coverage first, then cheapest: a cheap total with little coverage must not look like the winner
  shops.sort((a, b) => b.pricedItems - a.pricedItems || a.totalPence - b.totalPence || a.shop.label.localeCompare(b.shop.label));

  let likeForLike: LikeForLike | null = null;
  if (shops.length >= 2) {
    const common = live.filter((n) => shops.every((s) => pricedBy.get(s.shop.key)?.has(n.id)));
    if (common.length > 0) {
      const totals = shops.map((s) => ({ shop: s.shop, totalPence: common.reduce((t, n) => t + pricedBy.get(s.shop.key)!.get(n.id)!, 0) }))
        .sort((a, b) => a.totalPence - b.totalPence);
      const tie = totals.length > 1 && totals[0]!.totalPence === totals[1]!.totalPence;
      likeForLike = { itemIds: common.map((n) => n.id), itemNames: common.map((n) => n.name), totals, cheapest: tie ? null : totals[0]!.shop };
    }
  }

  const resolvedItems = live.filter((n) => n.ingredientId).length;
  let note = 'Totals cover only the items each shop has a price for, from your own receipts and prices. They are not a quote.';
  if (shops.length === 0) note = 'No shop prices for the items on this list yet. Confirm receipts or add prices you saw and this fills in.';
  else if (shops.length === 1) note = `Only ${shops[0]!.shop.label} has prices for this list so far, so there is nothing to compare.`;
  return { totalItems: live.length, resolvedItems, shops, likeForLike, byItem, note };
}
