// Price comparison per shop (P2-B, D401-D403): the "cheapest at" badges and "Where's cheapest for this list?" summary for the
// active shopping list, an ingredient's price history, and entering a price you saw. The maths is `@fr/engine/money`; this
// module only gathers inputs and shapes the view, so web and Android show the same thing.
import type { CanonicalIngredient, PriceObservation, Quantity } from '@fr/domain';
import {
  buildShopResolver, cheapestBadgeText, compareIngredient, compareList, isIsoDate, londonDateOf, priceHistory,
  type IngredientComparison, type ListNeed,
} from '@fr/engine/money';
import { isUnit } from '@fr/engine/units';
import type { ListCompareView, PriceHistoryView, StoreRef } from '../../money/types';

export interface PriceDeps {
  /** The household's price observations (own receipt / user_confirmed rows, plus generic: the engine ignores generic). */
  observations(householdId: string): Promise<PriceObservation[]>;
  ingredient(id: string): CanonicalIngredient | undefined;
  /** Ingredients with the density / unit-weight data the converter needs for costing list quantities. */
  ingredientsFor(ids: readonly string[]): CanonicalIngredient[];
  stores(householdId: string): Promise<StoreRef[]>;
  links(householdId: string): Promise<Record<string, string>>;
  /** What is still to buy on the household's active shopping list. */
  listNeeds(householdId: string): Promise<ListNeed[]>;
  record(householdId: string, observations: PriceObservation[]): Promise<void>;
  newId(): string;
  now(): Date;
}

export interface AddPriceInput {
  ingredientId: string;
  /** A household store, or free retailer text. */
  storeId?: string | null;
  retailer?: string | null;
  pricePence: number;
  packValue: number;
  packUnit: string;
  observedOn?: string;
}

export type AddPriceResult = { ok: true } | { ok: false; error: string };

export function comparisonView(c: IngredientComparison): PriceHistoryView['comparison'] {
  const best = c.cheapest;
  return {
    basis: c.basis, note: c.note, badge: cheapestBadgeText(c), tied: c.tied, savingPct: c.savingPct,
    shops: c.shops.map((s) => ({
      label: s.shop.label, linked: s.shop.linked, pricePence: s.latest.pricePence, packLabel: s.latest.unit?.packLabel ?? null, unitText: s.unitText,
      observedOn: s.latest.observedOn, ageText: s.ageText, count: s.count, stale: s.stale, comparable: s.comparable, kind: s.latest.kind,
      cheapest: !!best && s.comparable && (c.tied ? Math.abs((s.latest.unit?.pencePerUnit ?? -1) - best.latest.unit!.pencePerUnit) < 0.005 : s.shop.key === best.shop.key),
    })),
  };
}

export function createPriceService(deps: PriceDeps) {
  const today = () => londonDateOf(deps.now()) ?? deps.now().toISOString().slice(0, 10);

  async function context(householdId: string) {
    const [stores, links, observations] = await Promise.all([deps.stores(householdId), deps.links(householdId), deps.observations(householdId)]);
    return { stores, resolve: buildShopResolver(stores, links), observations };
  }

  return {
    /** Cheapest-at badges per list item and the per-shop totals for what is left to buy. */
    async listComparison(householdId: string): Promise<ListCompareView> {
      const { resolve, observations } = await context(householdId);
      const needs = await deps.listNeeds(householdId);
      const ids = [...new Set(needs.flatMap((n) => (n.ingredientId ? [n.ingredientId] : [])))];
      const r = compareList({ needs, observations, ingredients: deps.ingredientsFor(ids), resolve, today: today() });
      const badges: ListCompareView['badges'] = {};
      for (const [itemId, { ingredientId, comparison }] of Object.entries(r.byItem)) {
        const text = cheapestBadgeText(comparison);
        const c = comparison.cheapest;
        if (!text || !c) continue;
        badges[itemId] = {
          ingredientId, text, cheapestShop: c.shop.label, unitText: c.unitText ?? '', ageText: c.ageText, tied: comparison.tied,
          otherShops: comparison.shops.filter((s) => s.comparable).length - 1,
        };
      }
      return {
        totalItems: r.totalItems,
        shops: r.shops.map((s) => ({
          label: s.shop.label, storeId: s.shop.storeId ?? null, linked: s.shop.linked, totalPence: s.totalPence, pricedItems: s.pricedItems,
          coveragePct: s.coveragePct, missing: s.missing.slice(0, 30), oldestText: s.oldestText, allRecent: s.allRecent,
        })),
        likeForLike: r.likeForLike
          ? { itemNames: r.likeForLike.itemNames, totals: r.likeForLike.totals.map((t) => ({ label: t.shop.label, totalPence: t.totalPence })), cheapest: r.likeForLike.cheapest?.label ?? null }
          : null,
        badges, note: r.note,
      };
    },

    async history(householdId: string, ingredientId: string): Promise<PriceHistoryView | null> {
      const ing = deps.ingredient(ingredientId);
      if (!ing) return null;
      const { stores, resolve, observations } = await context(householdId);
      const t = today();
      const comparison = compareIngredient(observations, ingredientId, resolve, { today: t });
      return {
        ingredientId, name: ing.name, comparison: comparisonView(comparison),
        history: priceHistory(observations, ingredientId, resolve, t).map((h) => ({
          label: h.shop.label, pricePence: h.pricePence, packLabel: h.packLabel, unitText: h.unitText, observedOn: h.observedOn, ageText: h.ageText, kind: h.kind,
        })),
        stores,
      };
    },

    /** "I saw it for this price at that shop": a user_confirmed observation (the highest-trust kind, D124). */
    async addPrice(householdId: string, input: AddPriceInput): Promise<AddPriceResult> {
      const ing = deps.ingredient(input.ingredientId);
      if (!ing) return { ok: false, error: 'Choose an ingredient from the list.' };
      if (!Number.isInteger(input.pricePence) || input.pricePence < 1 || input.pricePence > 1_000_000) return { ok: false, error: 'Enter a price above zero.' };
      if (!(input.packValue > 0) || !Number.isFinite(input.packValue) || input.packValue > 1_000_000 || !isUnit(input.packUnit)) return { ok: false, error: 'Enter the pack size, for example 500 and g.' };
      const on = input.observedOn ?? today();
      if (!isIsoDate(on) || on > today()) return { ok: false, error: 'Choose a date that is not in the future.' };
      const stores = await deps.stores(householdId);
      const store = input.storeId ? stores.find((s) => s.id === input.storeId) : undefined;
      if (input.storeId && !store) return { ok: false, error: 'That store is not in this household.' };
      const retailer = (store?.name ?? input.retailer ?? '').trim().slice(0, 80);
      if (!retailer) return { ok: false, error: 'Say which shop it was.' };
      const packQuantity: Quantity = { kind: 'exact', value: Math.round(input.packValue * 1000) / 1000, unit: input.packUnit, originalText: `${input.packValue} ${input.packUnit}` };
      await deps.record(householdId, [{ ingredientId: input.ingredientId, retailer, pricePence: input.pricePence, packQuantity, kind: 'user_confirmed', observedOn: on, source: `manual:${deps.newId()}` }]);
      return { ok: true };
    },
  };
}

export type PriceService = ReturnType<typeof createPriceService>;
