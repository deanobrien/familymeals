import type { SupabaseClient } from '@supabase/supabase-js';

type Row = Record<string, unknown>;
type Result = { data: unknown; error: unknown };

/** Deterministic RFC-4122-shaped ids (the DTO schemas validate uuid format). */
export const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const USER_ME = uid(901);
export const USER_SAM = uid(902);
export const HH = uid(100);
export const LIST = uid(200);

const NETWORK_ERROR = { message: 'TypeError: Network request failed', code: '' };

class Query implements PromiseLike<Result> {
  private filters: Array<(r: Row) => boolean> = [];
  private orders: Array<{ col: string; asc: boolean }> = [];
  private max = Infinity;
  private single = false;
  constructor(
    private readonly backend: FakeBackend,
    private readonly table: string,
  ) {}
  select(_cols?: string) {
    this.backend.selects[this.table] = (this.backend.selects[this.table] ?? 0) + 1;
    return this;
  }
  eq(col: string, v: unknown) {
    this.filters.push((r) => r[col] === v);
    return this;
  }
  in(col: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[col]));
    return this;
  }
  gt(col: string, v: number) {
    this.filters.push((r) => Number(r[col]) > v);
    return this;
  }
  order(col: string, opts: { ascending?: boolean } = {}) {
    this.orders.push({ col, asc: opts.ascending ?? true });
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }
  private write: { op: 'upsert'; row: Row } | { op: 'delete' } | null = null;
  /** store_placements only (AS1): upsert keyed by store + target. */
  upsert(row: Row, _opts?: unknown) {
    this.write = { op: 'upsert', row };
    return this;
  }
  delete() {
    this.write = { op: 'delete' };
    return this;
  }
  private run(): Result {
    if (this.backend.offline) return { data: null, error: NETWORK_ERROR };
    if (this.write) {
      const list = this.backend.storeBook.placements as Row[];
      const same = (p: Row, r: Row) => p.storeId === r.store_id && p.targetType === r.target_type && p.targetKey === r.target_key;
      const asKey = (r: Row) => ({ store_id: r.store_id, target_type: r.target_type, target_key: r.target_key });
      const match = (p: Row) => this.filters.every((f) => f({ store_id: p.storeId, target_type: p.targetType, target_key: p.targetKey, household_id: HH }));
      if (this.write.op === 'delete') {
        this.backend.storeBook.placements = list.filter((p) => !match(p));
      } else {
        const r = this.write.row;
        const rest = list.filter((p) => !same(p, asKey(r)));
        rest.push({ storeId: r.store_id, targetType: r.target_type, targetKey: r.target_key, aisleId: r.aisle_id });
        this.backend.storeBook.placements = rest;
      }
      return { data: null, error: null };
    }
    let rows = (this.backend.tables[this.table] ?? []).filter((r) => this.filters.every((f) => f(r)));
    rows = [...rows].sort((a, b) => {
      for (const { col, asc } of this.orders) {
        const x = a[col] as number | string;
        const y = b[col] as number | string;
        if (x === y) continue;
        return (x < y ? -1 : 1) * (asc ? 1 : -1);
      }
      return 0;
    });
    rows = rows.slice(0, this.max).map((r) => ({ ...r }));
    return { data: this.single ? (rows[0] ?? null) : rows, error: null };
  }
  then<A = Result, B = never>(
    onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

/** In-memory stand-in for the Supabase project: tables, auth session, and the two shopping RPCs. */
export class FakeBackend {
  offline = false;
  /** Number of upcoming RPC calls that are processed server-side but whose response is lost (network error). */
  dropRpcResponses = 0;
  rpcError: { code?: string; message: string } | null = null;
  selects: Record<string, number> = {};
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  userId = USER_ME;
  tables: Record<string, Row[]> = {};
  /** household_store_book payload (AS1): empty unless a test fills it. */
  storeBook: { stores: Row[]; aisles: Row[]; placements: Row[] } = { stores: [], aisles: [], placements: [] };
  private seq = 0;
  private clock = 0;

  constructor() {
    this.tables = {
      households: [{ id: HH, name: 'The Smiths' }],
      household_members: [
        { household_id: HH, user_id: USER_ME, display_name: 'Dean', status: 'active' },
        { household_id: HH, user_id: USER_SAM, display_name: 'Sam', status: 'active' },
      ],
      shopping_lists: [{ id: LIST, household_id: HH, status: 'active', created_at: '2026-10-01T00:00:00Z' }],
      shopping_list_items: [
        this.item(uid(1), 'Milk', { quantity_kind: 'exact', quantity_value: 2, unit: 'l', original_text: '2 l' }, 'Dairy'),
        this.item(uid(2), 'Eggs', { quantity_kind: 'exact', quantity_value: 6, unit: 'item', original_text: '6' }, 'Dairy'),
        this.item(uid(3), 'Flour', { quantity_kind: 'exact', quantity_value: 1, unit: 'kg', original_text: '1 kg' }, 'Baking'),
        this.item(uid(4), 'Salt', { quantity_kind: 'to_taste', original_text: 'to taste' }, 'Baking'),
      ],
      purchase_events: [],
      shopping_command_log: [],
      recipes: [],
      recipe_ingredients: [],
      recipe_steps: [],
      ingredients: [],
      nutrition_profiles: [],
      nutrition_profile_values: [],
    };
  }

  private item(id: string, name: string, q: Row, aisle: string): Row {
    return {
      id,
      shopping_list_id: LIST,
      household_id: HH,
      ingredient_id: null,
      display_name: name,
      quantity_kind: q.quantity_kind,
      quantity_value: q.quantity_value ?? null,
      quantity_min: null,
      quantity_max: null,
      unit: q.unit ?? null,
      approx_label: null,
      original_text: q.original_text ?? '',
      unresolved: [],
      category: aisle,
      aisle,
      notes: null,
      is_manual: false,
      status: 'active',
      position: 0,
      created_by: USER_SAM,
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-01T00:00:00Z',
    };
  }

  private stamp() {
    this.clock += 1;
    return new Date(Date.UTC(2026, 9, 2, 0, 0, this.clock)).toISOString();
  }

  private itemRow(id: string) {
    return this.tables.shopping_list_items!.find((i) => i.id === id);
  }
  private activeEvents(itemId: string) {
    return this.tables.purchase_events!.filter((e) => e.shopping_list_item_id === itemId && !e.voided_at);
  }
  /** Same-unit-or-metric outstanding like SQL (mass -> g, volume -> ml); null when it can't convert. */
  private outstanding(item: Row): number | null {
    if (item.quantity_value === null || item.unit === null) return null;
    const f = (u: unknown) => ({ mg: 0.001, g: 1, kg: 1000, ml: 1, l: 1000 })[u as string];
    let bought = 0;
    for (const e of this.activeEvents(String(item.id))) {
      if (e.unit === item.unit) bought += Number(e.quantity_value);
      else if (f(e.unit) !== undefined && f(item.unit) !== undefined) bought += (Number(e.quantity_value) * f(e.unit)!) / f(item.unit)!;
      else return null;
    }
    return Number(item.quantity_value) - bought;
  }

  private log(commandId: string, listId: string, type: string, command: Row, result: Row, by: string) {
    this.seq += 1;
    this.tables.shopping_command_log!.push({
      seq: this.seq,
      command_id: commandId,
      household_id: HH,
      shopping_list_id: listId,
      command_type: type,
      command,
      status: result.status,
      reason: result.reason ?? null,
      result,
      created_by: by,
      created_at: this.stamp(),
    });
  }

  /** Server-side record_purchase (mirrors migration 0013). */
  recordPurchase(args: Row, by: string): Row {
    const commandId = String(args.p_event_id);
    const prior = this.tables.shopping_command_log!.find((l) => l.command_id === commandId);
    if (prior) return { ...(prior.result as Row), duplicate: true };
    const item = this.itemRow(String(args.p_item_id));
    if (!item) throw Object.assign(new Error('item_not_found'), { code: 'P0002' });
    const active = this.activeEvents(String(item.id));
    let result: Row | null = null;
    let qty: Row = { kind: 'unparsed', value: null, unit: null };
    let out = this.outstanding(item);
    if (item.status === 'removed') result = { status: 'rejected', reason: 'item_removed' };
    else if (args.p_mode === 'tick') {
      if (out === null && item.quantity_kind === 'to_taste') {
        if (active.length > 0) result = { status: 'rejected', reason: 'already_complete' };
        else qty = { kind: 'unparsed', value: null, unit: null };
      } else if (out === null) {
        if (args.p_expected_outstanding == null || args.p_expected_event_count !== active.length) {
          result = { status: 'rejected', reason: 'needs_engine_outstanding', activeEventCount: active.length };
        } else out = Number(args.p_expected_outstanding);
      }
      if (!result && item.quantity_kind !== 'to_taste') {
        if ((out ?? 0) <= 0) result = { status: 'rejected', reason: 'already_complete' };
        else qty = { kind: 'exact', value: out, unit: item.unit };
      }
    } else {
      const q = args.p_qty as Row | null;
      if (!q || !(Number(q.value) > 0)) result = { status: 'rejected', reason: 'invalid_quantity' };
      else qty = { kind: q.kind, value: Number(q.value), unit: q.unit ?? null };
    }
    if (!result) {
      this.tables.purchase_events!.push({
        id: commandId,
        shopping_list_item_id: item.id,
        household_id: HH,
        quantity_kind: qty.kind,
        quantity_value: qty.value,
        quantity_min: null,
        quantity_max: null,
        unit: qty.unit,
        approx_label: null,
        original_text: '',
        actual_price_pence: null,
        receipt_line_id: null,
        created_by: by,
        created_at: this.stamp(),
        voided_by: null,
        voided_at: null,
      });
      result = { status: 'applied', eventId: commandId, quantity: qty };
    } else if (result.reason === 'already_complete') {
      result = { ...result, completedBy: [...new Set(active.map((e) => e.created_by))] };
    }
    this.log(commandId, String(item.shopping_list_id), String(args.p_mode), { itemId: item.id, quantity: args.p_qty ?? null }, result, by);
    return result;
  }

  voidPurchase(args: Row, by: string): Row {
    const commandId = String(args.p_void_id);
    const prior = this.tables.shopping_command_log!.find((l) => l.command_id === commandId);
    if (prior) return { ...(prior.result as Row), duplicate: true };
    const ev = this.tables.purchase_events!.find((e) => e.id === args.p_event_id);
    if (!ev) throw Object.assign(new Error('event_not_found'), { code: 'P0002' });
    let result: Row;
    if (ev.voided_at) result = { status: 'rejected', reason: 'already_voided', eventId: ev.id };
    else {
      ev.voided_at = this.stamp();
      ev.voided_by = by;
      result = { status: 'applied', eventId: ev.id };
    }
    this.log(commandId, LIST, 'void', { eventId: ev.id }, result, by);
    return result;
  }

  /** Another household member ticks an item directly on the server. */
  otherUserTick(itemId: string, commandId: string, by = USER_SAM) {
    return this.recordPurchase({ p_event_id: commandId, p_item_id: itemId, p_mode: 'tick' }, by);
  }
  otherUserPurchase(itemId: string, commandId: string, value: number, unit: string, by = USER_SAM) {
    return this.recordPurchase(
      { p_event_id: commandId, p_item_id: itemId, p_mode: 'purchase', p_qty: { kind: 'exact', value, unit, originalText: `${value}${unit}` } },
      by,
    );
  }

  asClient(): SupabaseClient {
    const session = () => ({
      user: { id: this.userId, email: 'dean@example.com' },
      access_token: 'access-token-123',
    });
    const client = {
      from: (table: string) => new Query(this, table),
      rpc: async (fn: string, args: Record<string, unknown>): Promise<Result> => {
        this.rpcCalls.push({ fn, args });
        if (this.offline) return { data: null, error: NETWORK_ERROR };
        if (this.rpcError) return { data: null, error: this.rpcError };
        if (fn === 'household_store_book') return { data: this.storeBook, error: null };
        let data: Row;
        try {
          data = fn === 'record_purchase' ? this.recordPurchase(args, this.userId) : this.voidPurchase(args, this.userId);
        } catch (e) {
          return { data: null, error: { message: (e as Error).message, code: (e as { code?: string }).code } };
        }
        if (this.dropRpcResponses > 0) {
          this.dropRpcResponses -= 1;
          return { data: null, error: NETWORK_ERROR };
        }
        return { data, error: null };
      },
      auth: {
        getSession: async () => ({ data: { session: session() }, error: null }),
        signInWithPassword: async ({ password }: { email: string; password: string }) =>
          password === 'secret1'
            ? { data: { user: session().user, session: session() }, error: null }
            : { data: { user: null, session: null }, error: { message: 'Invalid login credentials' } },
        signOut: async () => ({ error: null }),
      },
    };
    return client as unknown as SupabaseClient;
  }
}
