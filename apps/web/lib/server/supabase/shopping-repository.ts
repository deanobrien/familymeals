// Supabase ShoppingRepository (lane S2, DECISIONS D120-D122). Same contract as InMemoryShoppingRepository: one ordered
// per-list command log (rejections included), idempotent on the client command id, a gap-free cursor.
//
//   decision    the @fr/engine reducer runs here, over a CONSISTENT snapshot (`shopping_list_snapshot`, one statement)
//   tick/purchase/undo   APPLIED only by `record_purchase` / `void_purchase` (lock-time outstanding re-check, SQL-NOTES);
//               an engine rejection is logged through `apply_shopping_command` without touching purchases
//   add/edit/remove/regenerate   the engine's changed items + the log row in one `apply_shopping_command` transaction,
//               guarded by an optimistic head check under the list lock (stale -> reload and decide again)
//   cursor      `shopping_command_log.list_seq` (per list, commit-ordered); log rows map back to engine LogEntries
import 'server-only';
import { createHash } from 'node:crypto';
import { quantityFromColumns } from '@fr/domain';
import type {
  Command, CommandResult, EngineContext, LogEntry, PurchaseEvent, Quantity, RejectReason, ShoppingItem, ShoppingState,
} from '../../shopping/engine';
import { applyCommand, deriveItem, emptyState, itemKey } from '../../shopping/engine';
import type { ListMeta, SnapshotDto } from '../../shopping/types';
import type { ShoppingRepository, SubmitOutcome } from '../shopping/repository';
import { SupabaseRepositoryError, callRpc, isUuid, selectAll, toIso, unwrap, type PgResult, type SupabaseClient } from './rpc';

type Row = Record<string, unknown>;

/** Actor placeholder for rows whose user was deleted (owner decision A: purchase history survives). */
export const DELETED_USER = '00000000-0000-0000-0000-000000000000';
const MAX_ATTEMPTS = 5;
/** How many derived ids a tick may be retried under after `needs_engine_outstanding` (also searched by undo). */
const TICK_RETRIES = 3;

/** Deterministic UUID-shaped id derived from another id. */
export function derivedUuid(seed: string, salt: string): string {
  const h = createHash('sha1').update(`${salt}:${seed}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export const tickRetryId = (commandId: string, attempt: number) => derivedUuid(commandId, `tick-retry-${attempt}`);

const LOG_TYPE: Record<Command['type'], string> = {
  tick: 'tick', purchase: 'purchase', undo: 'void', add_item: 'add', edit_item: 'edit', remove_item: 'remove', regenerate: 'regenerate',
};
const ENGINE_TYPE: Record<string, Command['type']> = {
  tick: 'tick', purchase: 'purchase', void: 'undo', add: 'add_item', edit: 'edit_item', remove: 'remove_item', regenerate: 'regenerate',
};
const ENGINE_REASONS = new Set<string>([
  'already_complete', 'already_voided', 'item_not_found', 'item_removed', 'event_not_found', 'invalid_quantity',
  'incompatible_unit', 'id_collision', 'superseded',
]);
/** SQL reasons -> engine reasons. `needs_engine_outstanding` is retried by the server (D121), hence 'superseded'. */
export function engineReason(reason: unknown): RejectReason {
  const r = String(reason ?? '');
  if (r === 'needs_engine_outstanding') return 'superseded';
  return (ENGINE_REASONS.has(r) ? r : 'invalid_quantity') as RejectReason;
}

const obj = (v: unknown): Row | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : undefined);
const str = (v: unknown): string | undefined => (v === null || v === undefined || v === '' ? undefined : String(v));
const num = (v: unknown): number | undefined => (v === null || v === undefined || v === '' ? undefined : Number(v));

/** A log row (DB shape) -> the engine LogEntry every replica replays (D121). */
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

  // Written by record_purchase / void_purchase (web server or the Android app).
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
    // An applied tick replays as the purchase of exactly what SQL recorded, so replay == snapshot (6 dp, D120).
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

function itemFromRow(row: Row): ShoppingItem {
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

/** Engine item -> `apply_shopping_command` payload. `quantity` = the derived TOTAL requirement (what SQL checks ticks against). */
export function itemPayload(state: ShoppingState, item: ShoppingItem, position: number, ctx: EngineContext): Row {
  const v = deriveItem(state, item, ctx);
  const text = item.requirement?.quantity.originalText ?? item.manualQuantity?.originalText ?? '';
  const quantity = !v.noLongerNeeded && v.quantified && v.unit
    ? { kind: 'exact', value: v.required, unit: v.unit, originalText: text }
    : { kind: 'unparsed', originalText: text };
  return {
    id: item.id, key: item.key, displayName: item.displayName.slice(0, 200), ingredientRef: item.ingredientId ?? null,
    category: item.category, aisle: item.aisle ?? null, notes: item.notes ?? null, isManual: !item.planLinked,
    position, planLinked: item.planLinked, requirement: item.requirement ?? null, manualQuantity: item.manualQuantity ?? null,
    removed: item.removed ?? null, quantity,
  };
}

export interface SupabaseShoppingRepositoryOptions {
  client: SupabaseClient;
  /** The household this instance is bound to (the session's); calls for another household are refused. */
  householdId: string;
  ctx: EngineContext;
}

/** One instance per data context (see backend.ts `lazy`): never caches across requests. */
export class SupabaseShoppingRepository implements ShoppingRepository {
  private readonly client: SupabaseClient;
  private readonly hh: string;
  private readonly ctx: EngineContext;

  constructor(o: SupabaseShoppingRepositoryOptions) {
    this.client = o.client;
    this.hh = o.householdId;
    this.ctx = o.ctx;
  }

  private check(householdId: string): void {
    if (householdId !== this.hh) throw new SupabaseRepositoryError('shopping', 'household does not match the session');
  }

  async load(): Promise<LoadedList> {
    return stateFromSnapshot(await callRpc<Row>(this.client, 'shopping_list_snapshot', { p_household_id: this.hh }));
  }

  private async activeListId(): Promise<string | null> {
    const res = (await this.client.from('shopping_lists').select('id').eq('household_id', this.hh).eq('status', 'active')
      .order('created_at', { ascending: false }).order('id', { ascending: false }).range(0, 0)) as PgResult<Row[]>;
    const rows = unwrap('shopping_lists active', res) ?? [];
    return rows[0] ? String(rows[0].id) : null;
  }

  async snapshot(householdId: string): Promise<SnapshotDto> {
    this.check(householdId);
    const loaded = await this.load();
    return { cursor: loaded.head, state: loaded.state, meta: await this.metaFor(loaded.state) };
  }

  async head(householdId: string): Promise<number> {
    this.check(householdId);
    const listId = await this.activeListId();
    if (!listId) return 0;
    const res = (await this.client.from('shopping_list_log_heads').select('head').eq('shopping_list_id', listId).maybeSingle()) as PgResult<Row>;
    return Number(unwrap('shopping head', res)?.head ?? 0);
  }

  async entriesSince(householdId: string, cursor: number): Promise<LogEntry[]> {
    this.check(householdId);
    const listId = await this.activeListId();
    if (!listId) return [];
    const rows = await selectAll<Row>('shopping log since', (from, to) =>
      this.client.from('shopping_command_log')
        .select('list_seq, command_id, command_type, command, status, reason, result, created_by, created_at')
        .eq('shopping_list_id', listId).gt('list_seq', cursor).order('list_seq', { ascending: true }).range(from, to) as unknown as PromiseLike<PgResult<Row[]>>);
    return rows.map(logRowToEntry);
  }

  async getMeta(householdId: string): Promise<ListMeta> {
    this.check(householdId);
    const listId = await this.activeListId();
    if (!listId) return { recipeTitles: {} };
    const rows = await selectAll<Row>('shopping requirements', (from, to) =>
      this.client.from('shopping_list_items').select('requirement').eq('shopping_list_id', listId).range(from, to) as unknown as PromiseLike<PgResult<Row[]>>);
    return this.titles(rows.map((r) => obj(r.requirement)));
  }

  /** Titles come from the recipes themselves (always current); nothing to store. */
  async mergeMeta(householdId: string): Promise<void> {
    this.check(householdId);
  }

  private metaFor(state: ShoppingState): Promise<ListMeta> {
    return this.titles(state.itemOrder.map((id) => state.items[id]!.requirement as Row | undefined));
  }

  private async titles(requirements: Array<Row | undefined>): Promise<ListMeta> {
    const ids = new Set<string>();
    for (const r of requirements) {
      for (const c of (r?.contributions as Row[] | undefined) ?? []) if (isUuid(c.recipeId)) ids.add(String(c.recipeId));
    }
    if (ids.size === 0) return { recipeTitles: {} };
    const res = (await this.client.from('recipes').select('id, title').eq('household_id', this.hh).in('id', [...ids])) as PgResult<Row[]>;
    const recipeTitles: Record<string, string> = {};
    for (const r of unwrap('recipe titles', res) ?? []) recipeTitles[String(r.id)] = String(r.title);
    return { recipeTitles };
  }

  async submit(householdId: string, cmd: Command): Promise<SubmitOutcome> {
    this.check(householdId);
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const out = await this.tryOnce(cmd);
      if (out) return out;
    }
    throw new SupabaseRepositoryError('shopping submit', 'the list kept changing; try again');
  }

  /** One decide-and-persist round. null = stale (the list moved underneath us): decide again. */
  private async tryOnce(original: Command): Promise<SubmitOutcome | null> {
    const loaded = await this.load();
    const { state } = loaded;
    const seen = state.outcomes[original.commandId];
    if (seen) return { result: seen, duplicate: true };

    let cmd = original;
    // Undo of a tick that was retried under a derived id (D121) targets the event that actually exists.
    if (cmd.type === 'undo' && !state.events[cmd.eventId]) {
      for (let i = 1; i <= TICK_RETRIES; i++) {
        const alt = tickRetryId(cmd.eventId, i);
        if (state.events[alt]) { cmd = { ...cmd, eventId: alt }; break; }
      }
    }

    const decided = applyCommand(state, cmd, this.ctx);
    const result = decided.result;
    if (result.status === 'rejected') {
      const listId = loaded.listId ?? await this.ensureList();
      return this.persistEngine(listId, cmd, result, [], loaded.head);
    }

    switch (cmd.type) {
      case 'tick': return this.tick(state, cmd);
      case 'purchase': return this.purchase(cmd);
      case 'undo': return this.voidEvent(cmd);
      default: {
        const listId = loaded.listId ?? await this.ensureList();
        const items: Row[] = [];
        decided.state.itemOrder.forEach((id, position) => {
          const next = decided.state.items[id]!;
          if (state.items[id] !== next) items.push(itemPayload(decided.state, next, position, this.ctx));
        });
        return this.persistEngine(listId, cmd, result, items, loaded.head);
      }
    }
  }

  private async ensureList(): Promise<string> {
    const id = await callRpc<string>(this.client, 'ensure_shopping_list', { p_household_id: this.hh });
    if (!id) throw new SupabaseRepositoryError('ensure_shopping_list', 'no list id returned');
    return String(id);
  }

  private async persistEngine(listId: string, cmd: Command, result: CommandResult, items: Row[], head: number): Promise<SubmitOutcome | null> {
    const r = await callRpc<Row>(this.client, 'apply_shopping_command', {
      p_list_id: listId, p_command_id: cmd.commandId, p_command_type: LOG_TYPE[cmd.type],
      p_command: cmd, p_result: result, p_items: items, p_expected_head: head,
    });
    if (!r || r.status === 'stale') return null;
    if (r.duplicate) return { result: { ...(r as unknown as CommandResult), commandId: cmd.commandId }, duplicate: true };
    return { result, duplicate: false };
  }

  private async tick(state: ShoppingState, cmd: Extract<Command, { type: 'tick' }>): Promise<SubmitOutcome | null> {
    const item = state.items[cmd.itemId]!;
    const v = deriveItem(state, item, this.ctx);
    let eventId = cmd.commandId;
    for (let retry = 0; retry <= TICK_RETRIES; retry++) {
      const r = await callRpc<Row>(this.client, 'record_purchase', {
        p_event_id: eventId, p_item_id: cmd.itemId, p_mode: 'tick',
        p_expected_outstanding: v.quantified ? v.outstanding : null,
        p_expected_event_count: v.activeEvents.length,
      });
      const res = r ?? {};
      if (res.status === 'rejected' && res.reason === 'needs_engine_outstanding' && !res.duplicate && retry < TICK_RETRIES) {
        // SQL could not convert and our engine numbers were stale: the id is consumed (logged as 'superseded').
        // Decide again from a fresh snapshot under a derived id, so a later undo of the original id still finds it.
        const fresh = await this.load();
        const freshItem = fresh.state.items[cmd.itemId];
        if (!freshItem) break;
        const again = applyCommand(fresh.state, { ...cmd, commandId: tickRetryId(cmd.commandId, retry + 1) }, this.ctx);
        if (again.result.status === 'rejected') {
          await this.persistEngine(fresh.listId!, { ...cmd, commandId: tickRetryId(cmd.commandId, retry + 1) }, again.result, [], fresh.head);
          return { result: { ...again.result, commandId: cmd.commandId }, duplicate: false };
        }
        Object.assign(v, deriveItem(fresh.state, freshItem, this.ctx));
        eventId = tickRetryId(cmd.commandId, retry + 1);
        continue;
      }
      return this.fromRpc(cmd, res, eventId);
    }
    return this.fromRpc(cmd, { status: 'rejected', reason: 'needs_engine_outstanding' }, eventId);
  }

  private async purchase(cmd: Extract<Command, { type: 'purchase' }>): Promise<SubmitOutcome> {
    const q = cmd.quantity;
    const r = await callRpc<Row>(this.client, 'record_purchase', {
      p_event_id: cmd.commandId, p_item_id: cmd.itemId, p_mode: 'purchase',
      p_qty: { kind: q.kind, value: q.value ?? null, unit: q.unit ?? null, originalText: q.originalText },
      p_price_pence: cmd.actualPricePence ?? null,
      p_receipt_line_id: isUuid(cmd.receiptLineId) ? cmd.receiptLineId : null,
    });
    return this.fromRpc(cmd, r ?? {}, cmd.commandId);
  }

  private async voidEvent(cmd: Extract<Command, { type: 'undo' }>): Promise<SubmitOutcome> {
    const r = await callRpc<Row>(this.client, 'void_purchase', { p_void_id: cmd.commandId, p_event_id: cmd.eventId });
    return this.fromRpc(cmd, r ?? {}, cmd.commandId);
  }

  /** record_purchase / void_purchase reply -> engine CommandResult for the caller's command id. */
  private fromRpc(cmd: Command, res: Row, eventId: string): SubmitOutcome {
    const itemId = 'itemId' in cmd ? cmd.itemId : undefined;
    const duplicate = Boolean(res.duplicate);
    if (res.status === 'applied') {
      return {
        result: {
          commandId: cmd.commandId, type: cmd.type, status: 'applied',
          ...(itemId ? { itemId } : {}), eventId: cmd.type === 'undo' ? cmd.eventId : eventId,
        },
        duplicate,
      };
    }
    const completedBy = Array.isArray(res.completedBy) ? res.completedBy.map((x) => (x == null ? DELETED_USER : String(x))) : undefined;
    return {
      result: {
        commandId: cmd.commandId, type: cmd.type, status: 'rejected', reason: engineReason(res.reason),
        ...(itemId ? { itemId } : {}), ...(cmd.type === 'undo' ? { eventId: cmd.eventId } : {}), ...(completedBy ? { completedBy } : {}),
      },
      duplicate,
    };
  }
}
