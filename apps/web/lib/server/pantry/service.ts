import {
  EXPIRING_SOON_DAYS, URGENCY_DAYS, addStock, applyAdjustments, assessConfidence, confirmStock, correctStock,
  expiringSoon, exactQ, fmtQ, isExact, makeCtx, planLeftovers, planPurchaseAdjustments, rankRecipesByPantry,
  today, daysBetween,
  type CookedBatch, type EngineCtx, type OpenSlot, type PantryAdjustment, type PantryItem, type Uuid,
} from '../../pantry/engine';
import {
  UNIT_OPTIONS, categoryLabel,
  type ActionResult, type BadgeView, type CategoryView, type ExpiringView, type ItemView, type LeftoverView,
  type PantrySettings, type PantryView, type PendingAdjustmentView, type PurchaseMode, type SuggestionView,
} from '../../pantry/types';
import type { IngredientLookup } from './ingredients';
import type { PantryRepository } from './repository';
import type { LeftoverSource, PurchaseEventSource, RecipeSummarySource } from './sources';

export interface PantryDeps {
  repo: PantryRepository;
  recipes: RecipeSummarySource;
  purchases: PurchaseEventSource;
  leftovers: LeftoverSource;
  ingredients: IngredientLookup;
  /** ISO datetime. Injected so tests control the clock. */
  now: () => string;
  newId?: () => Uuid;
}

export interface AddItemInput { name?: string; ingredientId?: string; value: number; unit: string; expiry?: string }
export interface CorrectItemInput { id: string; value: number; unit: string; /** '' / null clears the expiry */ expiry?: string | null }
export interface LeftoverInput { title: string; portionsCooked: number; portionsEaten: number; keepDays?: number; freezable?: boolean }

const fail = (error: string): ActionResult => ({ ok: false, error });
const ok = (message?: string): ActionResult => ({ ok: true, ...(message ? { message } : {}) });
const MODES: readonly PurchaseMode[] = ['off', 'suggest', 'auto'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(d: string): boolean {
  if (!ISO_DATE.test(d)) return false;
  const t = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
}

function validateQuantity(value: number, unit: string, allowZero = false): string | null {
  if (!Number.isFinite(value)) return 'Enter a quantity as a number.';
  if (allowZero ? value < 0 : value <= 0) return allowZero ? 'Quantity cannot be negative.' : 'Quantity must be more than zero.';
  if (value > 1_000_000) return 'That quantity looks too large.';
  if (!(UNIT_OPTIONS as readonly string[]).includes(unit)) return 'Choose a unit.';
  return null;
}

/** "Wed 21 Oct" in UTC, so server output is timezone-stable. */
export function formatDay(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  });
}

export function expiryBadge(expiry: string, now: string): BadgeView {
  const left = daysBetween(today(now), expiry);
  if (left < 0) return { tone: 'danger', label: left === -1 ? 'Expired yesterday' : `Expired ${-left} days ago` };
  if (left === 0) return { tone: 'danger', label: 'Expires today' };
  if (left === 1) return { tone: 'warning', label: 'Expires tomorrow' };
  if (left <= EXPIRING_SOON_DAYS) return { tone: 'warning', label: `Expires in ${left} days` };
  return { tone: 'neutral', label: `Use by ${formatDay(expiry)}` };
}

export function createPantryService(deps: PantryDeps) {
  const { repo, ingredients } = deps;

  const ctxFor = (settings: PantrySettings): EngineCtx =>
    makeCtx({ now: deps.now(), staleAfterDays: settings.staleAfterDays, ...(deps.newId ? { newId: deps.newId } : {}) });

  const categoryOf = (item: PantryItem): string =>
    (item.ingredientId ? ingredients.get(item.ingredientId)?.category : undefined) ?? 'other';

  function itemView(item: PantryItem, ctx: EngineCtx): ItemView {
    const conf = assessConfidence(item, ctx.now, ctx.policy);
    const q = item.quantity;
    return {
      id: item.id, name: item.name, quantityLabel: fmtQ(q), status: conf.status, confidenceMessage: conf.message,
      stale: conf.status === 'stale',
      ...(item.ingredientId ? { ingredientId: item.ingredientId } : {}),
      ...(isExact(q) ? { value: q.value, ...(q.unit ? { unit: q.unit } : {}) } : {}),
      ...(item.expiry ? { expiry: item.expiry, expiryBadge: expiryBadge(item.expiry, ctx.now) } : {}),
    };
  }

  /** Purchase-driven adjustments for the current mode, excluding anything already applied/dismissed. */
  async function planPurchases(householdId: Uuid, items: readonly PantryItem[], mode: PurchaseMode) {
    const records = await deps.purchases.list(householdId);
    const targets = new Map(records.map((r) => [r.event.shoppingListItemId, r.target]));
    const handled = await repo.getHandledEventIds(householdId);
    for (const it of items) for (const id of it.sourceEventIds ?? []) handled.add(id);
    const plan = planPurchaseAdjustments(records.map((r) => r.event), mode, (id) => targets.get(id), handled);
    // Stock is keyed by the canonical ingredient name, not whatever the shopping list called it.
    plan.adjustments = plan.adjustments.map((a) => {
      const canon = a.ingredientId ? ingredients.get(a.ingredientId)?.name : undefined;
      return canon ? { ...a, name: canon } : a;
    });
    return plan;
  }

  /** Auto mode: apply the precise adjustments on read (idempotent per event id). */
  async function syncAutoPurchases(householdId: Uuid, settings: PantrySettings): Promise<void> {
    if (settings.purchaseMode !== 'auto') return;
    const items = await repo.listItems(householdId);
    const plan = await planPurchases(householdId, items, 'auto');
    const auto = plan.adjustments.filter((a) => !a.requiresConfirmation);
    if (!auto.length) return;
    await repo.replaceItems(householdId, applyAdjustments(items, auto, ctxFor(settings)));
    await repo.markEventsHandled(householdId, auto.map((a) => a.sourceEventId));
  }

  function leftoverView(key: string, batch: CookedBatch, slots: readonly OpenSlot[]): LeftoverView {
    const plan = planLeftovers(batch, slots);
    const title = batch.recipeTitle ?? 'Leftovers';
    const suggestions = plan.suggestions.map((s) => `${s.portions} portion${s.portions === 1 ? '' : 's'} on ${formatDay(s.date)} ${s.mealType}`);
    return {
      key, title, portionsRemaining: plan.portionsRemaining, useBy: plan.useByDate, suggestions, advice: plan.advice,
      summary: plan.portionsRemaining
        ? `${plan.portionsRemaining} portion${plan.portionsRemaining === 1 ? '' : 's'} left, use by ${formatDay(plan.useByDate)}`
        : 'No portions left',
    };
  }

  return {
    async getView(householdId: Uuid): Promise<PantryView> {
      const settings = await repo.getSettings(householdId);
      await syncAutoPurchases(householdId, settings);
      const items = await repo.listItems(householdId);
      const ctx = ctxFor(settings);

      const views = items.map((i) => ({ item: i, view: itemView(i, ctx) }));
      const groups = new Map<string, ItemView[]>();
      for (const { item, view } of views) {
        const c = categoryOf(item);
        groups.set(c, [...(groups.get(c) ?? []), view]);
      }
      const categories: CategoryView[] = [...groups.entries()]
        .map(([category, list]) => ({ category, label: categoryLabel(category), items: list.sort((a, b) => a.name.localeCompare(b.name)) }))
        .sort((a, b) => (a.category === 'other' ? 1 : b.category === 'other' ? -1 : a.label.localeCompare(b.label)));

      const expiring: ExpiringView[] = expiringSoon(items, ctx.now, EXPIRING_SOON_DAYS).map(({ item, daysLeft, expired }) => ({
        id: item.id, name: item.name, quantityLabel: fmtQ(item.quantity), expiry: item.expiry as string, daysLeft, expired,
        badge: expiryBadge(item.expiry as string, ctx.now),
      }));

      const recipes = await deps.recipes.list(householdId);
      const suggestions: SuggestionView[] = rankRecipesByPantry(recipes, items, ctx, { urgencyDays: URGENCY_DAYS })
        .filter((r) => r.coverage > 0)
        .slice(0, 6)
        .map((r) => {
          const covPct = Math.round(r.coverage * 100);
          return {
            recipeId: r.recipeId, title: r.title, href: `/recipes/${r.recipeId}`, coveragePct: covPct,
            urgencyPct: Math.round(r.urgency * 100), covered: r.covered, missing: r.missing, explanations: r.explanations,
            headline: `${covPct}% covered` + (r.urgency > 0 ? ' - uses stock that is expiring soon' : ''),
          };
        });

      let pending: PendingAdjustmentView[] = [];
      if (settings.purchaseMode !== 'off') {
        const plan = await planPurchases(householdId, items, settings.purchaseMode);
        pending = plan.adjustments
          .filter((a) => a.requiresConfirmation)
          .map((a) => ({
            eventId: a.sourceEventId, name: a.name, quantityLabel: fmtQ(a.quantity), reason: a.reason,
            requiresConfirmation: a.requiresConfirmation, ...(a.ingredientId ? { ingredientId: a.ingredientId } : {}),
          }));
      }

      const batches = await deps.leftovers.listBatches(householdId);
      const slots = await deps.leftovers.listOpenSlots(householdId);
      const leftovers = batches.map((b) => leftoverView(b.recipeId, b, slots)).filter((l) => l.portionsRemaining > 0);

      return {
        householdId, settings, totalItems: items.length, categories,
        staleItems: views.filter((v) => v.view.stale).map((v) => v.view),
        expiring, suggestions, pending, leftovers,
      };
    },

    async addItem(householdId: Uuid, input: AddItemInput): Promise<ActionResult> {
      const bad = validateQuantity(input.value, input.unit);
      if (bad) return fail(bad);
      const ing = input.ingredientId ? ingredients.get(input.ingredientId) : undefined;
      if (input.ingredientId && !ing) return fail('Unknown ingredient.');
      const name = (input.name?.trim() || ing?.name || '').slice(0, 80);
      if (!name) return fail('Choose an ingredient or type a name.');
      if (input.expiry && !validDate(input.expiry)) return fail('Expiry must be a valid date.');
      const settings = await repo.getSettings(householdId);
      const items = await repo.listItems(householdId);
      const next = addStock(items, {
        householdId, name, quantity: exactQ(input.value, input.unit as never), source: 'manual',
        ...(ing ? { ingredientId: ing.id } : {}), ...(input.expiry ? { expiry: input.expiry } : {}),
      }, ctxFor(settings));
      await repo.replaceItems(householdId, next);
      return ok(`Added ${name}`);
    },

    async correctItem(householdId: Uuid, input: CorrectItemInput): Promise<ActionResult> {
      const bad = validateQuantity(input.value, input.unit, true);
      if (bad) return fail(bad);
      if (input.expiry && !validDate(input.expiry)) return fail('Expiry must be a valid date.');
      const settings = await repo.getSettings(householdId);
      const items = await repo.listItems(householdId);
      const target = items.find((i) => i.id === input.id);
      if (!target) return fail('That item no longer exists.');
      const next = correctStock(items, input.id, exactQ(input.value, input.unit as never), ctxFor(settings), input.expiry ? input.expiry : null);
      await repo.replaceItems(householdId, next);
      return ok(input.value === 0 ? `Removed ${target.name}` : `Updated ${target.name}`);
    },

    async confirmItem(householdId: Uuid, id: string): Promise<ActionResult> {
      const settings = await repo.getSettings(householdId);
      const items = await repo.listItems(householdId);
      const target = items.find((i) => i.id === id);
      if (!target) return fail('That item no longer exists.');
      await repo.replaceItems(householdId, confirmStock(items, id, ctxFor(settings)));
      return ok(`Confirmed ${target.name}`);
    },

    async removeItem(householdId: Uuid, id: string): Promise<ActionResult> {
      const items = await repo.listItems(householdId);
      const target = items.find((i) => i.id === id);
      if (!target) return fail('That item no longer exists.');
      await repo.replaceItems(householdId, items.filter((i) => i.id !== id));
      return ok(`Removed ${target.name}`);
    },

    async updateSettings(householdId: Uuid, input: PantrySettings): Promise<ActionResult> {
      if (!MODES.includes(input.purchaseMode)) return fail('Choose off, suggest or auto.');
      if (!Number.isInteger(input.staleAfterDays) || input.staleAfterDays < 1 || input.staleAfterDays > 730) {
        return fail('Staleness must be a whole number of days between 1 and 730.');
      }
      await repo.saveSettings(householdId, { purchaseMode: input.purchaseMode, staleAfterDays: input.staleAfterDays });
      return ok('Settings saved');
    },

    /** Suggest mode: the user accepts one pending purchase adjustment (optionally with an expiry). */
    async acceptAdjustment(householdId: Uuid, eventId: string, expiry?: string): Promise<ActionResult> {
      if (expiry && !validDate(expiry)) return fail('Expiry must be a valid date.');
      const settings = await repo.getSettings(householdId);
      if (settings.purchaseMode === 'off') return fail('Pantry updates from purchases are off.');
      const items = await repo.listItems(householdId);
      const plan = await planPurchases(householdId, items, settings.purchaseMode);
      const adj: PantryAdjustment | undefined = plan.adjustments.find((a) => a.sourceEventId === eventId);
      if (!adj) return fail('That purchase is no longer pending.');
      const expiryMap: Record<string, string> = adj.ingredientId && expiry ? { [adj.ingredientId]: expiry } : {};
      await repo.replaceItems(householdId, applyAdjustments(items, [adj], ctxFor(settings), expiryMap));
      await repo.markEventsHandled(householdId, [eventId]);
      return ok(`Added ${adj.name} to your pantry`);
    },

    async dismissAdjustment(householdId: Uuid, eventId: string): Promise<ActionResult> {
      const settings = await repo.getSettings(householdId);
      const items = await repo.listItems(householdId);
      const plan = await planPurchases(householdId, items, settings.purchaseMode === 'off' ? 'suggest' : settings.purchaseMode);
      if (!plan.adjustments.some((a) => a.sourceEventId === eventId)) return fail('That purchase is no longer pending.');
      await repo.markEventsHandled(householdId, [eventId]);
      return ok('Dismissed');
    },

    /** Ad-hoc leftovers calculation for a meal cooked today. */
    async planLeftovers(householdId: Uuid, input: LeftoverInput): Promise<{ ok: true; plan: LeftoverView } | { ok: false; error: string }> {
      const title = input.title.trim().slice(0, 80);
      if (!title) return { ok: false, error: 'Name the meal.' };
      const ints = [input.portionsCooked, input.portionsEaten];
      if (ints.some((n) => !Number.isInteger(n) || n < 0 || n > 100)) return { ok: false, error: 'Portions must be whole numbers.' };
      if (input.portionsEaten > input.portionsCooked) return { ok: false, error: 'You cannot have eaten more than you cooked.' };
      const slots = await deps.leftovers.listOpenSlots(householdId);
      const batch: CookedBatch = {
        recipeId: 'adhoc', recipeTitle: title, cookedOn: today(deps.now()),
        portionsCooked: input.portionsCooked, portionsEaten: input.portionsEaten,
        ...(input.keepDays ? { keepDays: input.keepDays } : {}), ...(input.freezable ? { freezable: true } : {}),
      };
      return { ok: true, plan: leftoverView('adhoc', batch, slots) };
    },

    searchIngredients: (query: string) => ingredients.search(query, 8),
  };
}

export type PantryService = ReturnType<typeof createPantryService>;
