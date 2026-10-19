import type { PurchaseEvent, Quantity, Uuid } from '../contract';
import { fmtQ, isExact } from './common';
import { addStock } from './ledger';
import type { EngineCtx, PantryItem } from './types';

export type PurchaseMode = 'off' | 'suggest' | 'auto';

export interface PantryAdjustment {
  sourceEventId: Uuid; householdId: Uuid; ingredientId?: Uuid; name: string; quantity: Quantity; reason: string;
  /** True when it must not be applied without the user's confirmation, even in auto mode. */
  requiresConfirmation: boolean;
}
export interface PurchaseTarget { ingredientId?: Uuid; name: string; householdId: Uuid }

export interface PurchaseOutcome {
  mode: PurchaseMode;
  /** Candidate adjustments. In auto mode apply those without requiresConfirmation; in suggest mode show all. */
  adjustments: PantryAdjustment[];
  ignored: { eventId: Uuid; reason: string }[];
}

/**
 * Turn PurchaseEvents into pantry adjustments according to the household setting.
 * Voided and already-applied events are skipped (idempotent offline replay).
 */
export function planPurchaseAdjustments(
  events: readonly PurchaseEvent[], mode: PurchaseMode,
  resolve: (shoppingListItemId: Uuid) => PurchaseTarget | undefined, alreadyApplied: ReadonlySet<Uuid> = new Set(),
): PurchaseOutcome {
  const out: PurchaseOutcome = { mode, adjustments: [], ignored: [] };
  for (const ev of events) {
    if (mode === 'off') { out.ignored.push({ eventId: ev.id, reason: 'pantry updates from purchases are off' }); continue; }
    if (ev.voidedBy) { out.ignored.push({ eventId: ev.id, reason: 'purchase was voided' }); continue; }
    if (alreadyApplied.has(ev.id)) { out.ignored.push({ eventId: ev.id, reason: 'already applied' }); continue; }
    const target = resolve(ev.shoppingListItemId);
    if (!target) { out.ignored.push({ eventId: ev.id, reason: 'shopping item not found' }); continue; }
    const precise = isExact(ev.quantity) && !!ev.quantity.unit && !!target.ingredientId;
    out.adjustments.push({
      sourceEventId: ev.id, householdId: target.householdId, name: target.name, quantity: ev.quantity,
      ...(target.ingredientId ? { ingredientId: target.ingredientId } : {}),
      reason: `Bought ${fmtQ(ev.quantity)} of ${target.name}` + (precise ? '' : ' (quantity or ingredient not exact — confirm)'),
      requiresConfirmation: mode === 'suggest' || !precise,
    });
  }
  return out;
}

/**
 * Apply adjustments to the ledger: pass the auto-applicable ones, or those the user accepted.
 * Idempotent per sourceEventId. `expiry` optionally supplies a user/default expiry per ingredient.
 */
export function applyAdjustments(
  items: readonly PantryItem[], adjustments: readonly PantryAdjustment[], ctx: EngineCtx, expiry: Record<Uuid, string> = {},
): PantryItem[] {
  let cur = [...items];
  for (const a of adjustments) {
    if (cur.some((i) => i.sourceEventIds?.includes(a.sourceEventId))) continue;
    const exp = a.ingredientId ? expiry[a.ingredientId] : undefined;
    cur = addStock(cur, {
      householdId: a.householdId, name: a.name, quantity: a.quantity, source: 'purchase', sourceEventId: a.sourceEventId,
      ...(a.ingredientId ? { ingredientId: a.ingredientId } : {}),
      ...(exp ? { expiry: exp } : {}),
    }, ctx);
  }
  return cur;
}
