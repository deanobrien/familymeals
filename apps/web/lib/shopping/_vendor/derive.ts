// TODO(merge batch 2): TEMPORARY VENDORED COPY of L17a (C:\TFS\FamilyRecipes-lanes\L17a-shopping-state\src).
// Replace with @fr/engine/shopping after merge batch 2 (one-line import change in ../engine.ts). Do not edit.
import type { PurchaseEvent, Quantity, Unit } from './contract';
import type { ShoppingItem, ShoppingState } from './model';
import { type EngineContext, isQuantified, round6, tolerance, unitOf, valueIn } from './units';

export type ItemStatus = 'outstanding' | 'partial' | 'complete' | 'over_purchased';

export interface ItemView {
  item: ShoppingItem;
  /** True when required/purchased are numeric in `unit`; false for to_taste/unparsed-only items. */
  quantified: boolean;
  unit?: Unit;
  required: number;
  purchased: number;
  outstanding: number;
  status: ItemStatus;
  /**
   * Nothing is required any more (plan dropped it, or user removed it). With purchases this is
   * the "purchased, no longer needed" state; it is never shown in the active view.
   */
  noLongerNeeded: boolean;
  activeEvents: PurchaseEvent[];
  voidedEvents: PurchaseEvent[];
  /** Active purchases whose quantity could not be converted to `unit` (not counted in `purchased`). */
  unconvertedEvents: PurchaseEvent[];
  /** Required parts that could not be combined into `unit` (plus Requirement.unresolved). */
  unresolvedRequired: Quantity[];
}

function eventsFor(state: ShoppingState, itemId: string): PurchaseEvent[] {
  const out: PurchaseEvent[] = [];
  for (const id of state.eventOrder) {
    const e = state.events[id];
    if (e && e.shoppingListItemId === itemId) out.push(e);
  }
  return out;
}

export function deriveItem(state: ShoppingState, item: ShoppingItem, ctx: EngineContext): ItemView {
  const all = eventsFor(state, item.id);
  const activeEvents = all.filter((e) => !e.voidedBy);
  const voidedEvents = all.filter((e) => !!e.voidedBy);
  const unresolvedRequired: Quantity[] = [...(item.requirement?.unresolved ?? [])];
  const unconvertedEvents: PurchaseEvent[] = [];

  const parts: Quantity[] = [];
  if (item.requirement) parts.push(item.requirement.quantity);
  if (item.manualQuantity) parts.push(item.manualQuantity);
  const quantifiedParts = parts.filter(isQuantified);
  const noLongerNeeded = !!item.removed || parts.length === 0;

  let quantified = false;
  let unit: Unit | undefined;
  let required = 0;
  let purchased = 0;

  if (!noLongerNeeded && quantifiedParts.length > 0) {
    quantified = true;
    unit = unitOf(quantifiedParts[0]!);
    for (const p of quantifiedParts) {
      const v = valueIn(p, unit, ctx, item.ingredientId);
      if (v === null) unresolvedRequired.push(p);
      else required += v;
    }
    for (const p of parts) if (!isQuantified(p)) unresolvedRequired.push(p);
  } else if (!noLongerNeeded) {
    unresolvedRequired.push(...parts);
  }

  if (quantified && unit) {
    for (const e of activeEvents) {
      const v = valueIn(e.quantity, unit, ctx, item.ingredientId);
      if (v === null) unconvertedEvents.push(e);
      else purchased += v;
    }
  } else if (!noLongerNeeded) {
    // Unquantified ("salt, to taste"): a purchase is binary.
    required = 1;
    purchased = activeEvents.length > 0 ? 1 : 0;
  } else {
    // Nothing required. Report purchased in the first event's unit when they agree, for display.
    const u = activeEvents[0] && isQuantified(activeEvents[0].quantity) ? unitOf(activeEvents[0].quantity) : undefined;
    if (u) {
      unit = u;
      quantified = true;
      for (const e of activeEvents) {
        const v = valueIn(e.quantity, u, ctx, item.ingredientId);
        if (v === null) unconvertedEvents.push(e);
        else purchased += v;
      }
    } else unconvertedEvents.push(...activeEvents);
  }

  required = round6(required);
  purchased = round6(purchased);
  const tol = tolerance(required);
  const anyPurchase = purchased > tol || unconvertedEvents.length > 0;

  let status: ItemStatus;
  if (noLongerNeeded) status = anyPurchase ? 'over_purchased' : 'complete';
  else if (!anyPurchase) status = 'outstanding';
  else if (purchased < required - tol) status = 'partial';
  else if (purchased <= required + tol) status = 'complete';
  else status = 'over_purchased';

  const outstanding = round6(Math.max(0, required - purchased));
  return {
    item, quantified, unit, required, purchased,
    outstanding: outstanding <= tol ? 0 : outstanding,
    status, noLongerNeeded, activeEvents, voidedEvents, unconvertedEvents, unresolvedRequired,
  };
}

export function deriveAll(state: ShoppingState, ctx: EngineContext): ItemView[] {
  return state.itemOrder.map((id) => deriveItem(state, state.items[id]!, ctx));
}

export interface ViewOptions {
  /** Default false: hide complete / over-purchased / no-longer-needed / removed items. */
  includeComplete?: boolean;
}

/** Active shopping view: outstanding + partial only (unless includeComplete). Removed items are always hidden. */
export function activeView(state: ShoppingState, ctx: EngineContext, opts: ViewOptions = {}): ItemView[] {
  return deriveAll(state, ctx).filter((v) => {
    if (v.item.removed) return false;
    if (opts.includeComplete) return true;
    return !v.noLongerNeeded && (v.status === 'outstanding' || v.status === 'partial');
  });
}

export interface ItemGroup { group: string; items: ItemView[] }

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Group by aisle (falling back to category, then 'Other'). Groups follow `aisleOrder` when given
 * (unknown groups after, alphabetically); items sorted by display name. Locale-independent ordering.
 */
export function groupByAisle(views: ItemView[], aisleOrder: string[] = []): ItemGroup[] {
  const map = new Map<string, ItemView[]>();
  for (const v of views) {
    const g = v.item.aisle || v.item.category || 'Other';
    const arr = map.get(g);
    if (arr) arr.push(v);
    else map.set(g, [v]);
  }
  const rank = (g: string): number => {
    const i = aisleOrder.indexOf(g);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...map.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || cmp(a, b))
    .map(([group, items]) => ({
      group,
      items: items.sort((x, y) => cmp(x.item.displayName.toLowerCase(), y.item.displayName.toLowerCase()) || cmp(x.item.id, y.item.id)),
    }));
}
