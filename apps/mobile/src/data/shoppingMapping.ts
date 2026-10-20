import { quantityFromColumns, type PurchaseEvent, type Quantity } from '@fr/domain';
import {
  emptyState,
  itemKey,
  type Command,
  type CommandResult,
  type LogEntry,
  type RejectReason,
  type ShoppingItem,
  type ShoppingState,
} from '@fr/engine/shopping';

/**
 * Row mapping for the per-list shopping model (D210). Mirrors `apps/web/lib/server/supabase/shopping-repository.ts`
 * (`logRowToEntry`, `itemFromRow`, `stateFromSnapshot`): the cursor is `shopping_command_log.list_seq` (per list,
 * gap-free, commit-ordered) and the snapshot is the `shopping_list_snapshot` RPC (one statement = one MVCC read).
 */

export type Row = Record<string, unknown>;

/** Actor placeholder for rows whose user was deleted (purchase history survives). */
export const DELETED_USER = '00000000-0000-0000-0000-000000000000';

const obj = (v: unknown): Row | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : undefined);
const str = (v: unknown): string | undefined => (v === null || v === undefined || v === '' ? undefined : String(v));
const num = (v: unknown): number | undefined => (v === null || v === undefined || v === '' ? undefined : Number(v));
const toIso = (v: unknown): string => {
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
};

const ENGINE_TYPE: Record<string, Command['type']> = {
  tick: 'tick', purchase: 'purchase', void: 'undo', add: 'add_item', edit: 'edit_item', remove: 'remove_item', regenerate: 'regenerate',
};
const ENGINE_REASONS = new Set<string>([
  'already_complete', 'already_voided', 'item_not_found', 'item_removed', 'event_not_found', 'invalid_quantity',
  'incompatible_unit', 'id_collision', 'superseded',
]);

/** SQL reasons -> engine reasons (`needs_engine_outstanding` is retried by the server, hence 'superseded'). */
export function engineReason(reason: unknown): RejectReason {
  const r = String(reason ?? '');
  if (r === 'needs_engine_outstanding') return 'superseded';
  return (ENGINE_REASONS.has(r) ? r : 'invalid_quantity') as RejectReason;
}

/** A `shopping_command_log` row (DB shape) -> the engine LogEntry every replica replays. */
export function logRowToEntry(row: Row): LogEntry {
  const seq = Number(row.list_seq);
  const commandId = String(row.command_id);
  const actor = str(row.created_by) ?? DELETED_USER;
  const at = toIso(row.created_at);
  const cmdJson = obj(row.command) ?? {};
  const res = obj(row.result) ?? {};
  const type = ENGINE_TYPE[String(row.command_type)] ?? 'tick';
  const rejected = row.status === 'rejected';

  // Written by apply_shopping_command: the engine's own command + result.
  if (typeof cmdJson.type === 'string') {
    const command = { ...(cmdJson as unknown as Command), commandId, actor };
    const result: CommandResult = rejected
      ? { ...(res as unknown as CommandResult), commandId, type: command.type, status: 'rejected', reason: engineReason(res.reason ?? row.reason) }
      : { ...(res as unknown as CommandResult), commandId, type: command.type, status: 'applied' };
    return { seq, command, result };
  }

  // Written by record_purchase / void_purchase (this app or the web server).
  const itemId = str(cmdJson.itemId);
  const base = { commandId, actor, at };
  if (rejected) {
    const command = (type === 'undo'
      ? { ...base, type: 'undo', eventId: str(cmdJson.eventId) ?? '' }
      : { ...base, type, itemId: itemId ?? '' }) as Command;
    const completedBy = Array.isArray(res.completedBy) ? res.completedBy.map((x) => (x == null ? DELETED_USER : String(x))) : undefined;
    const result: CommandResult = {
      commandId, type: command.type, status: 'rejected', reason: engineReason(row.reason ?? res.reason),
      ...(itemId ? { itemId } : {}),
      ...(str(res.eventId ?? cmdJson.eventId) ? { eventId: str(res.eventId ?? cmdJson.eventId)! } : {}),
      ...(completedBy ? { completedBy } : {}),
    };
    return { seq, command, result };
  }
  if (type === 'undo') {
    const eventId = str(cmdJson.eventId) ?? str(res.eventId) ?? '';
    return { seq, command: { ...base, type: 'undo', eventId }, result: { commandId, type: 'undo', status: 'applied', eventId } };
  }
  if (type === 'tick') {
    const q = obj(res.quantity);
    // An applied tick replays as the purchase of exactly what SQL recorded, so replay == snapshot (6 dp).
    if (q && q.kind === 'exact' && num(q.value) !== undefined && str(q.unit)) {
      const quantity = { kind: 'exact', value: num(q.value)!, unit: String(q.unit), originalText: 'tick' } as Quantity;
      return {
        seq, command: { ...base, type: 'purchase', itemId: itemId ?? '', quantity },
        result: { commandId, type: 'purchase', status: 'applied', itemId: itemId ?? '', eventId: commandId },
      };
    }
    return { seq, command: { ...base, type: 'tick', itemId: itemId ?? '' }, result: { commandId, type: 'tick', status: 'applied', itemId: itemId ?? '', eventId: commandId } };
  }
  const pq = obj(cmdJson.quantity) ?? {};
  const quantity = {
    kind: pq.kind === 'approximate' ? 'approximate' : 'exact', value: num(pq.value) ?? 0,
    ...(str(pq.unit) ? { unit: String(pq.unit) } : {}), originalText: String(pq.originalText ?? ''),
  } as Quantity;
  const price = num(cmdJson.pricePence);
  const receiptLineId = str(cmdJson.receiptLineId);
  return {
    seq,
    command: { ...base, type: 'purchase', itemId: itemId ?? '', quantity, ...(price !== undefined ? { actualPricePence: price } : {}), ...(receiptLineId ? { receiptLineId } : {}) },
    result: { commandId, type: 'purchase', status: 'applied', itemId: itemId ?? '', eventId: commandId },
  };
}

export function itemFromRow(row: Row): ShoppingItem {
  const ingredientId = str(row.ingredient_ref) ?? str(row.ingredient_id);
  const displayName = String(row.display_name ?? '');
  const requirement = obj(row.requirement) as ShoppingItem['requirement'] | undefined;
  let manualQuantity = obj(row.manual_quantity) as Quantity | undefined;
  // A row from another writer (no engine state): its flattened quantity is the manual requirement.
  if (!manualQuantity && !requirement && row.item_key == null) manualQuantity = quantityFromColumns(row);
  const removed = row.status === 'removed'
    ? { by: str(row.removed_by) ?? DELETED_USER, at: toIso(row.removed_at ?? row.updated_at), reason: (row.removed_reason === 'plan' ? 'plan' : 'user') as 'plan' | 'user' }
    : undefined;
  return {
    id: String(row.id),
    key: str(row.item_key) ?? itemKey(ingredientId, displayName),
    displayName,
    category: str(row.category) ?? 'Other',
    planLinked: Boolean(row.plan_linked),
    createdBy: str(row.created_by) ?? DELETED_USER,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    ...(ingredientId ? { ingredientId } : {}),
    ...(str(row.aisle) ? { aisle: String(row.aisle) } : {}),
    ...(str(row.notes) ? { notes: String(row.notes) } : {}),
    ...(requirement ? { requirement } : {}),
    ...(manualQuantity ? { manualQuantity } : {}),
    ...(removed ? { removed } : {}),
  };
}

export function eventFromRow(row: Row): PurchaseEvent {
  const price = num(row.actual_price_pence);
  return {
    id: String(row.id),
    shoppingListItemId: String(row.shopping_list_item_id),
    quantity: quantityFromColumns(row),
    createdBy: str(row.created_by) ?? DELETED_USER,
    createdAt: toIso(row.created_at),
    ...(price !== undefined ? { actualPricePence: price } : {}),
    ...(str(row.receipt_line_id) ? { receiptLineId: String(row.receipt_line_id) } : {}),
    ...(row.voided_at ? { voidedBy: str(row.voided_by) ?? DELETED_USER } : {}),
  };
}

export interface LoadedList {
  listId: string | null;
  /** The list's `list_seq` head at snapshot time: the engine cursor. */
  head: number;
  state: ShoppingState;
}

/** `shopping_list_snapshot` bundle -> engine state. Outcomes come from the log (the idempotency table). */
export function stateFromSnapshot(bundle: Row | null): LoadedList {
  const state = emptyState();
  if (!bundle || !bundle.listId) return { listId: null, head: 0, state };
  for (const r of (bundle.items as Row[] | undefined) ?? []) {
    const item = itemFromRow(r);
    state.items[item.id] = item;
    state.itemOrder.push(item.id);
  }
  for (const r of (bundle.events as Row[] | undefined) ?? []) {
    const e = eventFromRow(r);
    state.events[e.id] = e;
    state.eventOrder.push(e.id);
  }
  for (const r of (bundle.log as Row[] | undefined) ?? []) {
    const entry = logRowToEntry(r);
    state.outcomes[entry.command.commandId] = entry.result;
    if (entry.command.type === 'undo' && entry.result.status === 'applied') {
      state.voids[entry.command.commandId] = { id: entry.command.commandId, eventId: entry.command.eventId, by: entry.command.actor, at: entry.command.at };
    }
  }
  return { listId: String(bundle.listId), head: Number(bundle.head ?? 0), state };
}
