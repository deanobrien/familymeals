// Production wiring for the money services (P2-B). Both the web pages / server actions and the JSON routes for the Android
// app call these, inside the caller's data context, so the household is always the verified one.
import 'server-only';
import type { CanonicalIngredient } from '@fr/domain';
import type { ListNeed, PlannedWeek } from '@fr/engine/money';
import { deriveAll } from '@fr/engine/shopping';
import type { RecipeLite } from '../../plan/types';
import { plannedWeekOf } from './spending';
import { aisleForCategory } from '../../shopping/aisles';
import { loadPlanServices } from '../plan/services';
import { getPriceStore } from '../prices/store';
import { ensureDemoReceipts, getMemoryServices } from '../receipts/memory';
import { getIngredientCatalogue } from '../refdata/catalogue';
import { getShoppingStore } from '../shopping/store';
import { getStoreBook } from '../stores/store';
import { createSupabaseReceiptRepository, useSupabaseBackend } from '../supabase/backend';
import { createPriceService, type PriceService } from './prices';
import { createSpendingService, type SpendingService } from './spending';
import { getMoneyRepository } from './store';

function receipts() {
  return useSupabaseBackend() ? createSupabaseReceiptRepository() : getMemoryServices().receipts;
}

async function stores(householdId: string) {
  return (await getStoreBook().book(householdId)).stores.map((s) => ({ id: s.id, name: s.name, chain: s.chain ?? null }));
}

/** Estimated cost of each APPROVED plan week in [from, to]; "partial" when some meals/ingredients are unpriced. */
async function plannedWeeks(householdId: string, from: string, to: string): Promise<PlannedWeek[]> {
  const svc = await loadPlanServices(householdId);
  const docs = (await svc.plans.list(householdId)).filter((d) => d.status === 'approved' && d.weekStart >= from && d.weekStart <= to);
  if (docs.length === 0) return [];
  const ids = [...new Set(docs.flatMap((d) => Object.values(d.entries).flatMap((e) => (e.kind === 'recipe' ? [e.recipeId] : []))))];
  const found = new Map((await svc.recipes.get(householdId, ids)).map((r) => [r.id, r]));
  const lite = new Map<string, RecipeLite>(
    [...found.entries()].map(([id, r]) => [id, { costPerServingPence: r.costPerServingPence ?? null, costPartial: r.costPartial ?? false } as RecipeLite]),
  );
  return docs.map((d) => plannedWeekOf(d, lite));
}

export function getSpendingService(): SpendingService {
  const catalogue = getIngredientCatalogue();
  return createSpendingService({
    repo: getMoneyRepository(),
    receipts: {
      reconciledBetween: async (h, from, to) => {
        if (!useSupabaseBackend()) await ensureDemoReceipts(receipts(), h); // demo history in memory mode only, like /receipts
        return receipts().reconciledBetween(h, from, to);
      },
    },
    stores,
    plannedWeeks,
    weeklyBudgetPence: async (h) => (await loadPlanServices(h)).household.weeklyBudgetPence ?? null,
    categoryOf: (description) => {
      const m = catalogue.matcher.match(description);
      return m.status === 'matched' && m.ingredient ? aisleForCategory(m.ingredient.category) : undefined;
    },
    now: () => new Date(),
  });
}

export function getPriceService(): PriceService {
  const catalogue = getIngredientCatalogue();
  const prices = getPriceStore();
  return createPriceService({
    observations: async (h) => {
      await prices.refresh?.(h);
      return [...prices.asPriceSource(h).observations()];
    },
    ingredient: (id) => catalogue.get(id),
    ingredientsFor: (ids) => ids.flatMap((id): CanonicalIngredient[] => { const i = catalogue.get(id); return i ? [i] : []; }),
    stores,
    links: (h) => getMoneyRepository().links(h),
    listNeeds: async (h): Promise<ListNeed[]> => {
      const { state } = await getShoppingStore().snapshot(h);
      const nameIndex = new Map<string, string>();
      for (const ing of catalogue.all) for (const n of [ing.name, ...ing.aliases]) nameIndex.set(n.trim().toLowerCase().replace(/\s+/g, ' '), ing.id);
      return deriveAll(state, { converter: catalogue.converter })
        .filter((v) => !v.item.removed && !v.noLongerNeeded && (v.outstanding > 0 || !v.quantified))
        .map((v) => ({
          id: v.item.id, name: v.item.displayName,
          ingredientId: v.item.ingredientId ?? nameIndex.get(v.item.displayName.trim().toLowerCase().replace(/\s+/g, ' ')),
          outstanding: v.outstanding, unit: v.unit, quantified: v.quantified,
        }));
    },
    record: async (h, obs) => { await prices.record(h, obs); },
    newId: () => crypto.randomUUID(),
    now: () => new Date(),
  });
}
