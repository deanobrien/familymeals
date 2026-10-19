import type { IsoDate, Quantity, Uuid } from '../contract';
import { assessConfidence, EPS, exactQ, isExact, round6 } from './common';
import type { EngineCtx, PantryItem, PantrySource } from './types';

export interface AddStockInput {
  householdId: Uuid; ingredientId?: Uuid; name: string; quantity: Quantity;
  expiry?: IsoDate; source?: PantrySource; sourceEventId?: Uuid;
}

/**
 * Add stock. Merges into an existing confident, same-expiry, convertible item;
 * otherwise creates a new item (so adding to stale stock never launders its age).
 */
export function addStock(items: readonly PantryItem[], input: AddStockInput, ctx: EngineCtx): PantryItem[] {
  const source = input.source ?? 'manual';
  if (isExact(input.quantity) && input.quantity.unit && input.ingredientId) {
    const idx = items.findIndex((it) =>
      it.ingredientId === input.ingredientId && it.householdId === input.householdId &&
      it.expiry === input.expiry && isExact(it.quantity) &&
      assessConfidence(it, ctx.now, ctx.policy).status === 'confident');
    const target = idx >= 0 ? items[idx] : undefined;
    if (target && isExact(target.quantity)) {
      const tUnit = target.quantity.unit;
      const conv = tUnit === input.quantity.unit ? input.quantity
        : tUnit ? ctx.converter.convert(input.quantity, tUnit, input.ingredientId) : null;
      if (conv && isExact(conv)) {
        const merged: PantryItem = {
          ...target, quantity: exactQ(round6(target.quantity.value + conv.value), tUnit),
          lastUpdated: ctx.now, source,
          ...(input.sourceEventId || target.sourceEventIds
            ? { sourceEventIds: [...(target.sourceEventIds ?? []), ...(input.sourceEventId ? [input.sourceEventId] : [])] } : {}),
        };
        return items.map((it, i) => (i === idx ? merged : it));
      }
    }
  }
  const created: PantryItem = {
    id: ctx.newId(), householdId: input.householdId, name: input.name, quantity: input.quantity,
    lastUpdated: ctx.now, source,
    ...(input.ingredientId ? { ingredientId: input.ingredientId } : {}),
    ...(input.expiry ? { expiry: input.expiry } : {}),
    ...(input.sourceEventId ? { sourceEventIds: [input.sourceEventId] } : {}),
  };
  return [...items, created];
}

/** Manual correction: user states the real quantity. Resets confidence. Zero removes the item. */
export function correctStock(items: readonly PantryItem[], itemId: Uuid, quantity: Quantity, ctx: EngineCtx, expiry?: IsoDate | null): PantryItem[] {
  return items.flatMap((it) => {
    if (it.id !== itemId) return [it];
    if (isExact(quantity) && quantity.value <= EPS) return [];
    const next: PantryItem = { ...it, quantity, lastUpdated: ctx.now, source: 'correction' };
    if (expiry === null) delete next.expiry; else if (expiry) next.expiry = expiry;
    return [next];
  });
}

/** "Yes, still have it": refreshes confidence without changing the quantity. */
export function confirmStock(items: readonly PantryItem[], itemId: Uuid, ctx: EngineCtx): PantryItem[] {
  return items.map((it) => (it.id === itemId ? { ...it, lastUpdated: ctx.now } : it));
}

/** Items the UI should ask the user to confirm. */
export function staleItems(items: readonly PantryItem[], ctx: EngineCtx): PantryItem[] {
  return items.filter((it) => assessConfidence(it, ctx.now, ctx.policy).status === 'stale');
}

/** Reduce an item by `takeValue` (in the item's own unit). Removes at ~zero. Keeps lastUpdated (a deduction is not a confirmation). */
export function reduceItem(items: readonly PantryItem[], itemId: Uuid, takeValue: number): PantryItem[] {
  return items.flatMap((it) => {
    if (it.id !== itemId || !isExact(it.quantity)) return [it];
    const left = round6(it.quantity.value - takeValue);
    if (left <= EPS) return [];
    return [{ ...it, quantity: exactQ(left, it.quantity.unit) }];
  });
}
