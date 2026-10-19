import type { PurchaseEvent, Quantity } from '../contract';
import { deriveItem } from './derive';
import {
  type ApplyOutcome, type Command, type CommandResult, type RejectReason,
  type ShoppingItem, type ShoppingState, itemKey,
} from './model';
import { type EngineContext, exactQty, isQuantified, valueIn } from './units';

/**
 * Apply one command to the state. Pure and deterministic: the same state + command always yields
 * the same new state + result, which is what lets the server log be replayed on every client.
 *
 * Idempotency: every command carries a client-generated commandId. If it has been seen before
 * (applied OR rejected) the state is returned unchanged and the original result is returned with
 * `duplicate: true`. For tick/purchase the commandId is the PurchaseEvent id; for undo it is the
 * void record id.
 */
export function applyCommand(state: ShoppingState, cmd: Command, ctx: EngineContext): ApplyOutcome {
  const seen = state.outcomes[cmd.commandId];
  if (seen) return { state, result: { ...seen, duplicate: true } };

  const r = run(state, cmd, ctx);
  const result: CommandResult = 'reason' in r
    ? { commandId: cmd.commandId, type: cmd.type, status: 'rejected', ...r }
    : { commandId: cmd.commandId, type: cmd.type, status: 'applied', ...r.result };
  const base = 'reason' in r ? state : r.state;
  return { state: { ...base, outcomes: { ...base.outcomes, [cmd.commandId]: result } }, result };
}

type Rejection = { reason: RejectReason; itemId?: string; eventId?: string; completedBy?: string[] };
type Success = { state: ShoppingState; result: { itemId?: string; eventId?: string } };

const reject = (reason: RejectReason, extra: Omit<Rejection, 'reason'> = {}): Rejection => ({ reason, ...extra });

function putItem(state: ShoppingState, item: ShoppingItem): ShoppingState {
  const exists = !!state.items[item.id];
  return {
    ...state,
    items: { ...state.items, [item.id]: item },
    itemOrder: exists ? state.itemOrder : [...state.itemOrder, item.id],
  };
}

function putEvent(state: ShoppingState, e: PurchaseEvent): ShoppingState {
  return { ...state, events: { ...state.events, [e.id]: e }, eventOrder: [...state.eventOrder, e.id] };
}

const validPositive = (q: Quantity): boolean =>
  q.kind === 'exact' && typeof q.value === 'number' && Number.isFinite(q.value) && q.value > 0;

function run(state: ShoppingState, cmd: Command, ctx: EngineContext): Rejection | Success {
  switch (cmd.type) {
    case 'tick': {
      const item = state.items[cmd.itemId];
      if (!item) return reject('item_not_found', { itemId: cmd.itemId });
      if (item.removed) return reject('item_removed', { itemId: item.id });
      if (state.events[cmd.commandId]) return reject('id_collision', { itemId: item.id });
      const v = deriveItem(state, item, ctx);
      if (v.noLongerNeeded || v.outstanding <= 0) {
        return reject('already_complete', {
          itemId: item.id,
          completedBy: [...new Set(v.activeEvents.map((e) => e.createdBy))],
        });
      }
      const quantity: Quantity = v.quantified && v.unit
        ? exactQty(v.outstanding, v.unit)
        : { ...(item.requirement?.quantity ?? item.manualQuantity!) };
      const e: PurchaseEvent = {
        id: cmd.commandId, shoppingListItemId: item.id, quantity, createdBy: cmd.actor, createdAt: cmd.at,
      };
      return { state: putEvent(state, e), result: { itemId: item.id, eventId: e.id } };
    }

    case 'purchase': {
      const item = state.items[cmd.itemId];
      if (!item) return reject('item_not_found', { itemId: cmd.itemId });
      if (item.removed) return reject('item_removed', { itemId: item.id });
      if (state.events[cmd.commandId]) return reject('id_collision', { itemId: item.id });
      if (!validPositive(cmd.quantity)) return reject('invalid_quantity', { itemId: item.id });
      const v = deriveItem(state, item, ctx);
      if (v.quantified && v.unit && valueIn(cmd.quantity, v.unit, ctx, item.ingredientId) === null) {
        return reject('incompatible_unit', { itemId: item.id });
      }
      const e: PurchaseEvent = {
        id: cmd.commandId, shoppingListItemId: item.id, quantity: cmd.quantity,
        createdBy: cmd.actor, createdAt: cmd.at,
        ...(cmd.actualPricePence !== undefined ? { actualPricePence: cmd.actualPricePence } : {}),
        ...(cmd.receiptLineId !== undefined ? { receiptLineId: cmd.receiptLineId } : {}),
      };
      return { state: putEvent(state, e), result: { itemId: item.id, eventId: e.id } };
    }

    case 'undo': {
      const e = state.events[cmd.eventId];
      if (!e) return reject('event_not_found', { eventId: cmd.eventId });
      if (e.voidedBy) return reject('already_voided', { eventId: e.id, itemId: e.shoppingListItemId });
      const voided: PurchaseEvent = { ...e, voidedBy: cmd.actor };
      return {
        state: {
          ...state,
          events: { ...state.events, [e.id]: voided },
          voids: { ...state.voids, [cmd.commandId]: { id: cmd.commandId, eventId: e.id, by: cmd.actor, at: cmd.at } },
        },
        result: { itemId: e.shoppingListItemId, eventId: e.id },
      };
    }

    case 'add_item': {
      if (state.items[cmd.itemId]) return reject('id_collision', { itemId: cmd.itemId });
      if (cmd.quantity && isQuantified(cmd.quantity) && !(magnitudeOk(cmd.quantity))) {
        return reject('invalid_quantity', { itemId: cmd.itemId });
      }
      const key = itemKey(cmd.ingredientId, cmd.displayName);
      // Merge into an existing live item with the same key when the quantity can be combined.
      const target = findLive(state, key);
      if (target && cmd.quantity) {
        const merged = addQuantities(target.manualQuantity, cmd.quantity, ctx, target.ingredientId);
        if (merged) {
          const updated: ShoppingItem = {
            ...target, manualQuantity: merged, updatedAt: cmd.at,
            ...(cmd.notes && !target.notes ? { notes: cmd.notes } : {}),
          };
          return { state: putItem(state, updated), result: { itemId: target.id } };
        }
      }
      const item: ShoppingItem = {
        id: cmd.itemId, key, displayName: cmd.displayName, category: cmd.category, planLinked: false,
        createdBy: cmd.actor, createdAt: cmd.at, updatedAt: cmd.at,
        ...(cmd.ingredientId ? { ingredientId: cmd.ingredientId } : {}),
        ...(cmd.aisle ? { aisle: cmd.aisle } : {}),
        ...(cmd.notes ? { notes: cmd.notes } : {}),
        // A manual item with no quantity still needs "one of" something.
        manualQuantity: cmd.quantity ?? { kind: 'unparsed', originalText: cmd.displayName },
      };
      return { state: putItem(state, item), result: { itemId: item.id } };
    }

    case 'edit_item': {
      const item = state.items[cmd.itemId];
      if (!item) return reject('item_not_found', { itemId: cmd.itemId });
      if (item.removed) return reject('item_removed', { itemId: item.id });
      const p = cmd.patch;
      if (p.manualQuantity && isQuantified(p.manualQuantity) && !magnitudeOk(p.manualQuantity)) {
        return reject('invalid_quantity', { itemId: item.id });
      }
      const next: ShoppingItem = { ...item, updatedAt: cmd.at };
      if (p.displayName !== undefined) {
        next.displayName = p.displayName;
        if (!item.ingredientId) next.key = itemKey(undefined, p.displayName);
      }
      if (p.category !== undefined) next.category = p.category;
      if (p.aisle !== undefined) { if (p.aisle === null) delete next.aisle; else next.aisle = p.aisle; }
      if (p.notes !== undefined) { if (p.notes === null) delete next.notes; else next.notes = p.notes; }
      if (p.manualQuantity !== undefined) {
        if (p.manualQuantity === null) delete next.manualQuantity; else next.manualQuantity = p.manualQuantity;
      }
      return { state: putItem(state, next), result: { itemId: item.id } };
    }

    case 'remove_item': {
      const item = state.items[cmd.itemId];
      if (!item) return reject('item_not_found', { itemId: cmd.itemId });
      if (item.removed) return reject('item_removed', { itemId: item.id });
      const next: ShoppingItem = { ...item, removed: { by: cmd.actor, at: cmd.at, reason: 'user' }, updatedAt: cmd.at };
      return { state: putItem(state, next), result: { itemId: item.id } };
    }

    case 'regenerate':
      return regenerate(state, cmd);
  }
}

const magnitudeOk = (q: Quantity): boolean => {
  const vals = [q.value, q.min, q.max].filter((x): x is number => typeof x === 'number');
  return vals.every((x) => Number.isFinite(x) && x >= 0);
};

function findLive(state: ShoppingState, key: string): ShoppingItem | undefined {
  for (const id of state.itemOrder) {
    const it = state.items[id]!;
    if (it.key === key && !it.removed) return it;
  }
  return undefined;
}

/** a + b in a's unit (or b alone). Null if both quantified and not convertible, or either unquantified. */
function addQuantities(a: Quantity | undefined, b: Quantity, ctx: EngineContext, ingredientId?: string): Quantity | null {
  if (!a) return b;
  if (!isQuantified(a) || !isQuantified(b) || a.kind === 'range' || b.kind === 'range') return null;
  const unit = a.unit ?? 'item';
  const bv = valueIn(b, unit, ctx, ingredientId);
  if (bv === null) return null;
  return exactQty((a.value ?? 0) + bv, unit);
}

/**
 * Regenerate merge rules:
 *  - Match each line by key to a plan-linked item (live, or removed by the plan), else claim a live
 *    manual item with the same key, else create a new item with line.itemId.
 *  - Matched: requirement replaced; purchases, manual quantity, notes and the user's category/aisle kept.
 *    Items removed by the plan are revived; items removed by the USER stay removed (user decision wins).
 *  - Plan-linked items whose key is absent from the new plan: requirement cleared. With active purchases
 *    or a manual quantity they stay (purchases shown as "purchased, no longer needed"); otherwise soft-
 *    removed with reason 'plan'. Purchase history is never touched.
 */
function regenerate(state: ShoppingState, cmd: Extract<Command, { type: 'regenerate' }>): Success {
  let s = state;
  const claimed = new Set<string>();
  const firstWhere = (pred: (i: ShoppingItem) => boolean): ShoppingItem | undefined => {
    for (const id of s.itemOrder) {
      const it = s.items[id]!;
      if (!claimed.has(it.id) && pred(it)) return it;
    }
    return undefined;
  };

  for (const line of cmd.lines) {
    const key = itemKey(line.requirement.ingredientId, line.requirement.displayName);
    const match =
      firstWhere((i) => i.key === key && i.planLinked && (!i.removed || i.removed.reason === 'plan')) ??
      firstWhere((i) => i.key === key && i.planLinked) ??
      firstWhere((i) => i.key === key && !i.removed);
    if (match) {
      claimed.add(match.id);
      const next: ShoppingItem = { ...match, requirement: line.requirement, planLinked: true, updatedAt: cmd.at };
      if (next.removed?.reason === 'plan') delete next.removed;
      s = putItem(s, next);
    } else if (!s.items[line.itemId]) {
      claimed.add(line.itemId);
      s = putItem(s, {
        id: line.itemId, key, displayName: line.requirement.displayName, category: line.category,
        requirement: line.requirement, planLinked: true,
        createdBy: cmd.actor, createdAt: cmd.at, updatedAt: cmd.at,
        ...(line.requirement.ingredientId ? { ingredientId: line.requirement.ingredientId } : {}),
        ...(line.aisle ? { aisle: line.aisle } : {}),
      });
    }
    // else: id collision on a brand-new line id; skip deterministically (caller bug, ids must be fresh).
  }

  for (const id of s.itemOrder) {
    const it = s.items[id]!;
    if (claimed.has(id) || !it.planLinked || !it.requirement) continue;
    const next: ShoppingItem = { ...it, updatedAt: cmd.at };
    delete next.requirement;
    const hasPurchases = s.eventOrder.some((eid) => {
      const e = s.events[eid]!;
      return e.shoppingListItemId === id && !e.voidedBy;
    });
    if (!hasPurchases && !next.manualQuantity && !next.removed) {
      next.removed = { by: cmd.actor, at: cmd.at, reason: 'plan' };
    }
    s = putItem(s, next);
  }
  return { state: s, result: {} };
}
