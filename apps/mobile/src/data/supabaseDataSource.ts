import type { SupabaseClient } from '@supabase/supabase-js';
import {
  PurchaseCommandResult,
  quantityFromColumns,
  recordPurchaseArgs,
  type NutrientValue,
  type PurchaseEvent,
  type Quantity,
  type Uuid,
} from '@fr/domain';
import { createQuantityConverter } from '@fr/engine/units';
import type { PlacementTargetType, StoreBook } from '@fr/engine/shopping';
import { isStoreBook, parseStoreBook } from '@/lib/storeBook';
import {
  applyCommand,
  clientEnqueue,
  clientIngest,
  clientResync,
  clientTakeConflicts,
  clientView,
  createClient,
  deriveAll,
  deriveItem,
  itemKey,
  type ClientState,
  type Command,
  type CommandResult,
  type EngineContext,
  type ItemView,
  type LogEntry,
  type ShoppingItem,
  type ShoppingState,
  type Snapshot,
} from '@fr/engine/shopping';
import type { Household, Recipe, ShoppingConflict, ShoppingListItem, UserSession } from '@/viewModels';
import { newId } from '@/lib/format';
import type { DataSource, ShoppingListState } from './DataSource';
import { OfflineStore } from './offlineQueue';

type Row = Record<string, unknown>;

const FORMER_MEMBER = 'former-member';
const LOG_PAGE = 500;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const optStr = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

/** A failed Supabase call. `retryable` = transient (offline / 5xx): keep queued and try again later. */
export class DataSourceError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'DataSourceError';
  }
}

interface ErrorLike {
  message?: string;
  code?: string;
  status?: number;
}

export function toDataSourceError(e: unknown): DataSourceError {
  if (e instanceof DataSourceError) return e;
  const err = (e ?? {}) as ErrorLike;
  const message = err.message ?? (e instanceof Error ? e.message : 'Request failed');
  const code = err.code || undefined;
  const network = /network|fetch|timed? ?out|offline|failed to connect|ECONN|ENOTFOUND/i.test(message);
  const retryable = network || !code || code.startsWith('PGRST0') || (err.status !== undefined && err.status >= 500);
  return new DataSourceError(message, retryable, code);
}

async function run<T>(p: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  let res: { data: T | null; error: unknown };
  try {
    res = await p;
  } catch (e) {
    throw toDataSourceError(e);
  }
  if (res.error) throw toDataSourceError(res.error);
  return res.data as T;
}

interface HouseholdState {
  listId: string | null;
  client: ClientState;
  /** user id -> display name, for "Sam already got this". */
  members: Map<string, string>;
}

export interface SupabaseDataSourceOptions {
  client: SupabaseClient;
  store?: OfflineStore;
  /** Test seam: id generator for command ids. */
  newId?: () => string;
  now?: () => Date;
}

/**
 * DataSource over supabase-js using only the anon key and the user's session: RLS decides what is visible
 * and purchases are written exclusively through the `record_purchase` / `void_purchase` RPCs
 * (client-generated command_id = idempotency key, rejections come back as data, never as exceptions).
 *
 * Shopping state is the engine's offline client model (`@fr/engine/shopping`): `confirmed` = last snapshot +
 * command-log replay from `cursor`, `pending` = queued local commands (persisted in AsyncStorage), view =
 * pending replayed over confirmed. Reconnect = resend pending in order (retries are safe), then ingest the log
 * since the cursor; a seq gap, an unknown command type or any divergence falls back to a fresh snapshot.
 */
export class SupabaseDataSource implements DataSource {
  private readonly db: SupabaseClient;
  private readonly store: OfflineStore;
  private readonly genId: () => string;
  private readonly now: () => Date;
  private readonly ctx: EngineContext = { converter: createQuantityConverter() };
  private readonly households = new Map<string, HouseholdState>();
  private conflicts: ShoppingConflict[] = [];
  private online = true;
  private flushing: Promise<number> | null = null;
  /** Command ids already re-issued once after `needs_engine_outstanding` (no endless loops). */
  private readonly reissued = new Set<string>();
  private readonly reportedConflicts = new Set<string>();

  constructor(opts: SupabaseDataSourceOptions) {
    this.db = opts.client;
    this.store = opts.store ?? new OfflineStore();
    this.genId = opts.newId ?? newId;
    this.now = opts.now ?? (() => new Date());
  }

  setOnline(online: boolean) {
    this.online = online;
  }

  // ---- auth ----------------------------------------------------------------------------------------------

  async getSession(): Promise<UserSession | null> {
    const { data } = await this.db.auth.getSession();
    const user = data.session?.user;
    return user ? { userId: user.id, email: user.email ?? '' } : null;
  }

  async signIn(email: string, password: string): Promise<UserSession> {
    const { data, error } = await this.db.auth.signInWithPassword({ email, password });
    if (error || !data.user) throw new Error(error?.message ?? 'Sign-in failed');
    return { userId: data.user.id, email: data.user.email ?? email };
  }

  async signOut(): Promise<void> {
    await this.db.auth.signOut();
    this.households.clear();
    this.conflicts = [];
  }

  async getAccessToken(): Promise<string | null> {
    const { data } = await this.db.auth.getSession();
    return data.session?.access_token ?? null;
  }

  private async userId(): Promise<string> {
    const s = await this.getSession();
    if (!s) throw new Error('Not signed in');
    return s.userId;
  }

  // ---- households & recipes ---------------------------------------------------------------------------------

  async listHouseholds(): Promise<Household[]> {
    const hs = await run<Row[]>(this.db.from('households').select('id,name').order('name'));
    const ms = await run<Row[]>(this.db.from('household_members').select('household_id,status').eq('status', 'active'));
    const counts = new Map<string, number>();
    for (const m of ms ?? []) counts.set(str(m.household_id), (counts.get(str(m.household_id)) ?? 0) + 1);
    return (hs ?? []).map((h) => ({ id: str(h.id), name: str(h.name), memberCount: counts.get(str(h.id)) ?? 0 }));
  }

  async listRecipes(householdId: Uuid): Promise<Recipe[]> {
    const rows = await run<Row[]>(
      this.db
        .from('recipes')
        .select('id,household_id,title,default_servings,diet_category')
        .eq('household_id', householdId)
        .eq('status', 'active')
        .order('title'),
    );
    return (rows ?? []).map((r) => ({
      id: str(r.id),
      householdId: str(r.household_id),
      title: str(r.title),
      servings: Number(r.default_servings ?? 0),
      ...(optStr(r.diet_category) ? { dietCategory: r.diet_category as NonNullable<Recipe['dietCategory']> } : {}),
      ingredients: [],
      steps: [],
      nutrition: [],
    }));
  }

  async getRecipe(recipeId: Uuid): Promise<Recipe | null> {
    const r = await run<Row | null>(
      this.db
        .from('recipes')
        .select('id,household_id,title,default_servings,diet_category')
        .eq('id', recipeId)
        .maybeSingle(),
    );
    if (!r) return null;
    const lines = await run<Row[]>(
      this.db.from('recipe_ingredients').select('*').eq('recipe_id', recipeId).order('position'),
    );
    const steps = await run<Row[]>(
      this.db.from('recipe_steps').select('step_number,instructions').eq('recipe_id', recipeId).order('step_number'),
    );
    const ingredientIds = [...new Set((lines ?? []).map((l) => optStr(l.ingredient_id)).filter((x): x is string => !!x))];
    const names = new Map<string, string>();
    if (ingredientIds.length > 0) {
      const ings = await run<Row[]>(this.db.from('ingredients').select('id,name').in('id', ingredientIds));
      for (const i of ings ?? []) names.set(str(i.id), str(i.name));
    }
    return {
      id: str(r.id),
      householdId: str(r.household_id),
      title: str(r.title),
      servings: Number(r.default_servings ?? 0),
      ...(optStr(r.diet_category) ? { dietCategory: r.diet_category as NonNullable<Recipe['dietCategory']> } : {}),
      ingredients: (lines ?? []).map((l) => {
        const matched = optStr(l.ingredient_id) ? names.get(str(l.ingredient_id)) : undefined;
        // An unmatched line keeps the author's text whole ("500g minced beef"): do not repeat the quantity.
        const quantity: Quantity = matched
          ? quantityFromColumns(l)
          : { kind: 'unparsed', originalText: '' };
        return {
          id: str(l.id),
          name: matched ?? str(l.original_text),
          quantity,
          ...(optStr(l.preparation) ? { preparation: str(l.preparation) } : {}),
          optional: Boolean(l.optional),
          order: Number(l.position ?? 0),
        };
      }),
      steps: (steps ?? []).map((s) => str(s.instructions)),
      nutrition: await this.loadNutrition(recipeId),
    };
  }

  private async loadNutrition(recipeId: string): Promise<NutrientValue[]> {
    const profiles = await run<Row[]>(
      this.db
        .from('nutrition_profiles')
        .select('id,calculated_at')
        .eq('recipe_id', recipeId)
        .eq('basis', 'per_serving')
        .order('calculated_at', { ascending: false })
        .limit(1),
    );
    const p = profiles?.[0];
    if (!p) return [];
    const vals = await run<Row[]>(
      this.db.from('nutrition_profile_values').select('*').eq('nutrition_profile_id', str(p.id)),
    );
    return (vals ?? []).map((v) => {
      const status = str(v.value_status) as NutrientValue['status'];
      const known = status === 'known' || status === 'zero';
      return {
        nutrient: str(v.nutrient) as NutrientValue['nutrient'],
        status,
        unit: str(v.unit) as NutrientValue['unit'],
        estimate: Boolean(v.estimate),
        // Unknown/unavailable keep NO value: the UI must show "Unknown", never 0.
        ...(known && v.value !== null && v.value !== undefined ? { value: Number(v.value) } : {}),
      };
    });
  }

  // ---- shopping: load / resync ---------------------------------------------------------------------------------

  private async fetchMembers(householdId: string): Promise<Map<string, string>> {
    const rows = await run<Row[]>(
      this.db.from('household_members').select('user_id,display_name').eq('household_id', householdId),
    );
    const m = new Map<string, string>();
    for (const r of rows ?? []) if (optStr(r.display_name)) m.set(str(r.user_id), str(r.display_name));
    return m;
  }

  private async fetchActiveListId(householdId: string): Promise<string | null> {
    const rows = await run<Row[]>(
      this.db
        .from('shopping_lists')
        .select('id')
        .eq('household_id', householdId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1),
    );
    return rows?.[0] ? str(rows[0].id) : null;
  }

  /**
   * Fresh snapshot. The cursor is read BEFORE the rows so nothing logged in between is missed; replaying a log
   * entry already reflected in the snapshot is harmless (the engine rejects it as a duplicate id / already voided).
   */
  private async fetchSnapshot(listId: string): Promise<Snapshot> {
    const last = await run<Row[]>(
      this.db
        .from('shopping_command_log')
        .select('seq')
        .eq('shopping_list_id', listId)
        .order('seq', { ascending: false })
        .limit(1),
    );
    const cursor = last?.[0] ? Number(last[0].seq) : 0;
    const itemRows = await run<Row[]>(
      this.db
        .from('shopping_list_items')
        .select('*')
        .eq('shopping_list_id', listId)
        .order('position')
        .order('created_at'),
    );
    const items: ShoppingItem[] = (itemRows ?? []).map(itemFromRow);
    let eventRows: Row[] = [];
    if (items.length > 0) {
      eventRows = await run<Row[]>(
        this.db
          .from('purchase_events')
          .select('*')
          .in(
            'shopping_list_item_id',
            items.map((i) => i.id),
          )
          .order('created_at'),
      );
    }
    const events = (eventRows ?? []).map(eventFromRow);
    const state: ShoppingState = {
      items: Object.fromEntries(items.map((i) => [i.id, i])),
      itemOrder: items.map((i) => i.id),
      events: Object.fromEntries(events.map((e) => [e.id, e])),
      eventOrder: events.map((e) => e.id),
      voids: {},
      outcomes: {},
    };
    return { cursor, state };
  }

  private async loadHousehold(householdId: string, keep?: HouseholdState): Promise<HouseholdState> {
    const pending = keep ? keep.client.pending : await this.store.loadPending(householdId);
    try {
      const members = await this.fetchMembers(householdId);
      const listId = await this.fetchActiveListId(householdId);
      const snapshot: Snapshot = listId ? await this.fetchSnapshot(listId) : { cursor: 0, state: emptyShoppingState() };
      const client: ClientState = { ...createClient(snapshot), pending };
      const h: HouseholdState = { listId, client, members };
      await this.cache(householdId, h);
      return h;
    } catch (e) {
      const err = toDataSourceError(e);
      if (!err.retryable) throw err;
      if (keep) return keep;
      const cached = await this.store.loadSnapshot(householdId);
      if (!cached) throw err;
      return {
        listId: cached.listId,
        client: { ...createClient({ cursor: cached.cursor, state: cached.state }), pending },
        members: new Map(Object.entries(cached.members)),
      };
    }
  }

  private async cache(householdId: string, h: HouseholdState) {
    await this.store.saveSnapshot(householdId, {
      listId: h.listId,
      cursor: h.client.cursor,
      state: h.client.confirmed,
      members: Object.fromEntries(h.members),
    });
  }

  private async persist(householdId: string, h: HouseholdState) {
    await this.store.savePending(householdId, h.client.pending);
  }

  private async ensureLoaded(householdId: string): Promise<HouseholdState> {
    let h = this.households.get(householdId);
    if (!h) {
      h = await this.loadHousehold(householdId);
      this.households.set(householdId, h);
      return h;
    }
    if (this.online) await this.sync(householdId, h);
    return this.households.get(householdId) ?? h;
  }

  /**
   * Catch up from the log cursor. Returns false when offline / transient failure (state untouched).
   * Falls back to a full snapshot on a seq gap, an unmappable entry, or when the engine's replay of an
   * applied purchase disagrees with the server.
   */
  private async sync(householdId: string, h: HouseholdState): Promise<boolean> {
    try {
      if (!h.listId) {
        // No list yet (or never loaded online): try a full load.
        const fresh = await this.loadHousehold(householdId, h);
        this.households.set(householdId, fresh);
        return true;
      }
      const rows = await run<Row[]>(
        this.db
          .from('shopping_command_log')
          .select('*')
          .eq('shopping_list_id', h.listId)
          .gt('seq', h.client.cursor)
          .order('seq')
          .limit(LOG_PAGE),
      );
      const entries = (rows ?? []).map(logEntryFromRow);
      if (entries.length === 0) return true;
      if (entries.some((e) => e === null) || (rows ?? []).length >= LOG_PAGE) return await this.resnapshot(householdId, h);

      const good = entries as LogEntry[];
      const ingested = clientIngest(h.client, good, this.ctx);
      const diverged = good.some(
        (e) => e.result.status === 'applied' && (e.command.type === 'tick' || e.command.type === 'purchase') && !ingested.confirmed.events[e.command.commandId],
      );
      if (ingested.needsResync || diverged) return await this.resnapshot(householdId, h);
      const [next, taken] = clientTakeConflicts(ingested);
      h.client = next;
      for (const r of taken) this.pushConflict(h, r);
      await this.cache(householdId, h);
      await this.persist(householdId, h);
      return true;
    } catch (e) {
      const err = toDataSourceError(e);
      if (err.retryable) return false;
      throw err;
    }
  }

  private async resnapshot(householdId: string, h: HouseholdState): Promise<boolean> {
    if (!h.listId) return false;
    const snapshot = await this.fetchSnapshot(h.listId);
    h.client = clientResync(h.client, snapshot, [], this.ctx);
    h.members = await this.fetchMembers(householdId).catch(() => h.members);
    await this.cache(householdId, h);
    await this.persist(householdId, h);
    return true;
  }

  // ---- shopping: view -------------------------------------------------------------------------------------------

  async getShoppingList(householdId: Uuid): Promise<ShoppingListState> {
    const h = await this.ensureLoaded(householdId);
    if (this.online && h.client.pending.length > 0) {
      await this.flushHousehold(householdId);
    }
    return this.view(householdId, this.households.get(householdId) ?? h);
  }

  private view(householdId: string, h: HouseholdState): ShoppingListState {
    const state = clientView(h.client, this.ctx);
    const views = deriveAll(state, this.ctx).filter((v) => !v.item.removed && !(v.noLongerNeeded && v.activeEvents.length === 0));
    const items = sortByAisle(views).map((v) => toListItem(householdId, v));
    const pendingItemIds = [
      ...new Set(
        h.client.pending
          .map((c) => ('itemId' in c ? c.itemId : c.type === 'undo' ? state.events[c.eventId]?.shoppingListItemId : undefined))
          .filter((x): x is string => !!x),
      ),
    ];
    return { items, pendingItemIds };
  }

  // ---- stores and aisles (AS1, D298) ----------------------------------------------------------------------------

  async getStoreBook(householdId: Uuid): Promise<StoreBook> {
    try {
      const res = (await this.db.rpc('household_store_book', { p_household_id: householdId })) as { data: unknown; error: { message: string } | null };
      if (res.error) throw new Error(res.error.message);
      const book = parseStoreBook(res.data);
      await this.store.saveValue(householdId, 'storebook', book);
      return book;
    } catch {
      const cached = await this.store.loadValue<unknown>(householdId, 'storebook'); // offline: the last book we saw
      return isStoreBook(cached) ? cached : { stores: [], aisles: [], placements: [] };
    }
  }

  async setPlacement(
    householdId: Uuid,
    storeId: Uuid,
    target: { targetType: PlacementTargetType; targetKey: string },
    aisleId: Uuid | null,
  ): Promise<void> {
    const t = this.db.from('store_placements');
    const res = (aisleId === null
      ? await t.delete().eq('household_id', householdId).eq('store_id', storeId).eq('target_type', target.targetType).eq('target_key', target.targetKey)
      : await t.upsert(
          { household_id: householdId, store_id: storeId, aisle_id: aisleId, target_type: target.targetType, target_key: target.targetKey, updated_at: this.now().toISOString() },
          { onConflict: 'store_id,target_type,target_key' },
        )) as { error: { message: string } | null };
    if (res.error) throw new Error('Could not save the aisle. Check your connection and try again.');
    const cached = await this.store.loadValue<unknown>(householdId, 'storebook');
    if (isStoreBook(cached)) {
      const placements = cached.placements.filter((p) => !(p.storeId === storeId && p.targetType === target.targetType && p.targetKey === target.targetKey));
      if (aisleId) placements.push({ storeId, aisleId, ...target });
      await this.store.saveValue(householdId, 'storebook', { ...cached, placements });
    }
  }

  getSelectedStoreId(householdId: Uuid): Promise<string | null> {
    return this.store.loadValue<string>(householdId, 'store');
  }
  setSelectedStoreId(householdId: Uuid, storeId: string | null): Promise<void> {
    return this.store.saveValue(householdId, 'store', storeId);
  }

  // ---- shopping: commands ---------------------------------------------------------------------------------------

  async tickItem(householdId: Uuid, itemId: Uuid): Promise<PurchaseEvent> {
    const h = await this.ensureLoaded(householdId);
    const actor = await this.userId();
    const cmd: Command = { type: 'tick', commandId: this.genId(), actor, at: this.now().toISOString(), itemId };
    const local = applyCommand(clientView(h.client, this.ctx), cmd, this.ctx);
    if (local.result.status === 'rejected') {
      throw new Error(local.result.reason === 'already_complete' ? 'Nothing left to buy for this item.' : 'This item cannot be ticked.');
    }
    const event = local.state.events[cmd.commandId] as PurchaseEvent;
    h.client = clientEnqueue(h.client, cmd);
    await this.persist(householdId, h);
    await this.flushIfOnline(householdId);
    return event;
  }

  async undoTick(householdId: Uuid, itemId: Uuid): Promise<void> {
    const h = await this.ensureLoaded(householdId);
    const actor = await this.userId();
    const state = clientView(h.client, this.ctx);
    const active = deriveItem(state, state.items[itemId] as ShoppingItem, this.ctx).activeEvents;
    const last = active[active.length - 1];
    if (!last) throw new Error('Nothing to undo for this item.');
    const cmd: Command = { type: 'undo', commandId: this.genId(), actor, at: this.now().toISOString(), eventId: last.id };
    h.client = clientEnqueue(h.client, cmd);
    await this.persist(householdId, h);
    await this.flushIfOnline(householdId);
  }

  pendingCount(): number {
    let n = 0;
    for (const h of this.households.values()) n += h.client.pending.length;
    return n;
  }

  takeConflicts(): ShoppingConflict[] {
    const out = this.conflicts;
    this.conflicts = [];
    return out;
  }

  private async flushIfOnline(householdId: string) {
    if (this.online) await this.flushHousehold(householdId);
  }

  async flushPending(): Promise<number> {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      let n = 0;
      for (const id of [...this.households.keys()]) n += await this.flushHousehold(id);
      return n;
    })().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  /** Send queued commands in order. Stops at the first transient failure so ordering is preserved. */
  private async flushHousehold(householdId: string): Promise<number> {
    const h = this.households.get(householdId);
    if (!h || !this.online) return 0;
    let delivered = 0;
    const acked = new Set<string>();
    for (let i = 0; i < h.client.pending.length && this.online; i++) {
      const cmd = h.client.pending[i] as Command;
      if (acked.has(cmd.commandId)) continue;
      const out = await this.send(h, cmd);
      if (out.kind === 'retry') break;
      if (out.kind === 'reissue') {
        // The server consumed this command id with a stale-count rejection: refresh, then resend under a new id.
        await this.resnapshot(householdId, h);
        const fresh = { ...cmd, commandId: this.genId() } as Command;
        this.reissued.add(fresh.commandId);
        h.client = { ...h.client, pending: h.client.pending.map((c) => (c.commandId === cmd.commandId ? fresh : c)) };
        await this.persist(householdId, h);
        i--;
        continue;
      }
      acked.add(cmd.commandId);
      if (out.kind === 'applied') delivered++;
      else this.pushConflict(h, out.result);
    }
    if (acked.size > 0) {
      await this.sync(householdId, h);
      // Acked commands are now in `confirmed` (or rejected): drop them. If sync was offline they would simply
      // be re-sent later and the server would answer `duplicate`.
      h.client = { ...h.client, pending: h.client.pending.filter((c) => !acked.has(c.commandId)) };
      await this.persist(householdId, h);
      await this.cache(householdId, h);
    }
    return delivered;
  }

  private async send(
    h: HouseholdState,
    cmd: Command,
  ): Promise<
    | { kind: 'applied' }
    | { kind: 'rejected'; result: CommandResult }
    | { kind: 'reissue' }
    | { kind: 'retry' }
  > {
    try {
      let data: unknown;
      if (cmd.type === 'tick' || cmd.type === 'purchase') {
        const expected = cmd.type === 'tick' ? this.expectedFor(h, cmd.itemId) : undefined;
        const args = recordPurchaseArgs({
          eventId: cmd.commandId,
          itemId: cmd.itemId,
          mode: cmd.type,
          ...(cmd.type === 'purchase' ? { quantity: cmd.quantity } : {}),
          ...(cmd.type === 'purchase' && cmd.actualPricePence !== undefined ? { pricePence: cmd.actualPricePence } : {}),
          ...(cmd.type === 'purchase' && cmd.receiptLineId ? { receiptLineId: cmd.receiptLineId } : {}),
          ...(expected ?? {}),
        });
        data = await run<unknown>(this.db.rpc('record_purchase', args));
      } else if (cmd.type === 'undo') {
        data = await run<unknown>(this.db.rpc('void_purchase', { p_void_id: cmd.commandId, p_event_id: cmd.eventId }));
      } else {
        // add/edit/remove/regenerate are web-only for now; never queued by this app.
        return { kind: 'rejected', result: { commandId: cmd.commandId, type: cmd.type, status: 'rejected', reason: 'invalid_quantity' } };
      }
      const parsed = PurchaseCommandResult.safeParse(data);
      if (!parsed.success) throw new DataSourceError('Unexpected server response', false);
      const r = parsed.data;
      if (r.status === 'applied') return { kind: 'applied' };
      if (r.reason === 'needs_engine_outstanding' && !this.reissued.has(cmd.commandId)) return { kind: 'reissue' };
      return {
        kind: 'rejected',
        result: {
          commandId: cmd.commandId,
          type: cmd.type,
          status: 'rejected',
          reason: r.reason as CommandResult['reason'] & string,
          ...('itemId' in cmd ? { itemId: cmd.itemId } : {}),
          ...(r.completedBy ? { completedBy: r.completedBy } : {}),
        },
      };
    } catch (e) {
      const err = toDataSourceError(e);
      if (err.retryable) return { kind: 'retry' };
      // Final server error (item gone, read-only household, ...): report once, do not retry forever.
      return {
        kind: 'rejected',
        result: {
          commandId: cmd.commandId,
          type: cmd.type,
          status: 'rejected',
          reason: err.code === 'P0002' ? 'item_not_found' : 'item_removed',
          ...('itemId' in cmd ? { itemId: cmd.itemId } : {}),
        },
      };
    }
  }

  /** Engine-computed outstanding for ticks, used by the server only when SQL cannot convert units itself. */
  private expectedFor(h: HouseholdState, itemId: string) {
    const item = h.client.confirmed.items[itemId];
    if (!item) return undefined;
    const v = deriveItem(h.client.confirmed, item, this.ctx);
    if (!v.quantified) return undefined;
    return { expectedOutstanding: Math.max(0, v.outstanding), expectedEventCount: v.activeEvents.length };
  }

  private pushConflict(h: HouseholdState, r: CommandResult) {
    // A rejection can be seen twice: from the RPC reply and from the replayed command log. Report it once.
    if (this.reportedConflicts.has(r.commandId)) return;
    this.reportedConflicts.add(r.commandId);
    const itemId = r.itemId ?? (r.eventId ? h.client.confirmed.events[r.eventId]?.shoppingListItemId : undefined);
    const name = (itemId && h.client.confirmed.items[itemId]?.displayName) || 'This item';
    const who = (r.completedBy ?? []).map((u) => h.members.get(u) ?? 'Someone');
    const message = conflictMessage(name, r.reason, who);
    this.conflicts.push({ commandId: r.commandId, ...(itemId ? { itemId } : {}), itemName: name, message });
  }
}

export function conflictMessage(name: string, reason: CommandResult['reason'] | undefined, who: string[]): string {
  switch (reason) {
    case 'already_complete':
      return who.length > 0 ? `${[...new Set(who)].join(' and ')} already got ${name}.` : `${name} was already bought.`;
    case 'already_voided':
      return 'That purchase was already undone.';
    case 'item_removed':
    case 'item_not_found':
      return `${name} is no longer on the list.`;
    case 'invalid_quantity':
    case 'incompatible_unit':
      return `Could not record ${name}: the quantity is not valid.`;
    default:
      return `Could not sync ${name}. Pull to refresh and try again.`;
  }
}

// ---- row mapping -------------------------------------------------------------------------------------------------

function emptyShoppingState(): ShoppingState {
  return { items: {}, itemOrder: [], events: {}, eventOrder: [], voids: {}, outcomes: {} };
}

export function itemFromRow(r: Row): ShoppingItem {
  const quantity = quantityFromColumns(r);
  const displayName = str(r.display_name);
  const ingredientId = optStr(r.ingredient_id);
  const manual = Boolean(r.is_manual);
  const unresolved = Array.isArray(r.unresolved) ? (r.unresolved as Quantity[]) : [];
  const createdBy = optStr(r.created_by) ?? FORMER_MEMBER;
  const item: ShoppingItem = {
    id: str(r.id),
    key: itemKey(ingredientId, displayName),
    displayName,
    category: optStr(r.category) ?? 'Other',
    planLinked: !manual,
    createdBy,
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
    ...(ingredientId ? { ingredientId } : {}),
    ...(optStr(r.aisle) ? { aisle: str(r.aisle) } : {}),
    ...(optStr(r.notes) ? { notes: str(r.notes) } : {}),
    ...(manual
      ? { manualQuantity: quantity }
      : {
          requirement: {
            displayName,
            quantity,
            contributions: [],
            ...(ingredientId ? { ingredientId } : {}),
            ...(unresolved.length > 0 ? { unresolved } : {}),
          },
        }),
  };
  if (str(r.status) === 'removed') item.removed = { by: createdBy, at: str(r.updated_at), reason: 'user' };
  return item;
}

export function eventFromRow(r: Row): PurchaseEvent {
  const voided = r.voided_at !== null && r.voided_at !== undefined;
  return {
    id: str(r.id),
    shoppingListItemId: str(r.shopping_list_item_id),
    quantity: quantityFromColumns(r),
    createdBy: optStr(r.created_by) ?? FORMER_MEMBER,
    createdAt: str(r.created_at),
    ...(typeof r.actual_price_pence === 'number' ? { actualPricePence: r.actual_price_pence } : {}),
    ...(optStr(r.receipt_line_id) ? { receiptLineId: str(r.receipt_line_id) } : {}),
    ...(voided ? { voidedBy: optStr(r.voided_by) ?? FORMER_MEMBER } : {}),
  };
}

/** shopping_command_log row -> engine LogEntry. Null for command types the mobile client cannot replay. */
export function logEntryFromRow(r: Row): LogEntry | null {
  const seq = Number(r.seq);
  const type = str(r.command_type);
  const cmd = (r.command ?? {}) as Record<string, unknown>;
  const base = { commandId: str(r.command_id), actor: optStr(r.created_by) ?? FORMER_MEMBER, at: str(r.created_at) };
  const resultJson = (r.result ?? {}) as Record<string, unknown>;
  const status = str(r.status) === 'rejected' ? 'rejected' : 'applied';
  const result: CommandResult = {
    commandId: base.commandId,
    type: type === 'void' ? 'undo' : (type as CommandResult['type']),
    status,
    ...(status === 'rejected' && optStr(r.reason) ? { reason: str(r.reason) as CommandResult['reason'] & string } : {}),
    ...(optStr(cmd.itemId) ? { itemId: str(cmd.itemId) } : {}),
    ...(Array.isArray(resultJson.completedBy) ? { completedBy: resultJson.completedBy as string[] } : {}),
    ...(optStr(resultJson.eventId) ? { eventId: str(resultJson.eventId) } : {}),
  };
  if (type === 'tick') {
    return { seq, command: { type: 'tick', ...base, itemId: str(cmd.itemId) }, result };
  }
  if (type === 'purchase') {
    const quantity = cmd.quantity as Quantity | null | undefined;
    if (!quantity) return null;
    return {
      seq,
      command: {
        type: 'purchase',
        ...base,
        itemId: str(cmd.itemId),
        quantity,
        ...(typeof cmd.pricePence === 'number' ? { actualPricePence: cmd.pricePence } : {}),
        ...(optStr(cmd.receiptLineId) ? { receiptLineId: str(cmd.receiptLineId) } : {}),
      },
      result,
    };
  }
  if (type === 'void') {
    return { seq, command: { type: 'undo', ...base, eventId: str(cmd.eventId) }, result };
  }
  return null;
}

// ---- view helpers ------------------------------------------------------------------------------------------------

function sortByAisle(views: ItemView[]): ItemView[] {
  const group = (v: ItemView) => v.item.aisle || v.item.category || 'Other';
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return [...views].sort(
    (a, b) =>
      // Open items first, ticked ones sink to the bottom of their aisle.
      Number(isTicked(a)) - Number(isTicked(b)) ||
      cmp(group(a), group(b)) ||
      cmp(a.item.displayName.toLowerCase(), b.item.displayName.toLowerCase()) ||
      cmp(a.item.id, b.item.id),
  );
}

const isTicked = (v: ItemView) => v.noLongerNeeded || v.status === 'complete' || v.status === 'over_purchased';

function toListItem(householdId: string, v: ItemView): ShoppingListItem {
  const ticked = isTicked(v);
  const required = v.item.requirement?.quantity ?? v.item.manualQuantity ?? { kind: 'unparsed' as const, originalText: v.item.displayName };
  const quantity: Quantity =
    !ticked && v.quantified && v.unit && v.purchased > 0
      ? { kind: 'exact', value: Math.round(v.outstanding * 1000) / 1000, unit: v.unit, originalText: `${v.outstanding} ${v.unit}` }
      : required;
  return {
    id: v.item.id,
    householdId,
    displayName: v.item.displayName,
    quantity,
    aisle: v.item.aisle || v.item.category || 'Other',
    ...(v.item.ingredientId ? { ingredientId: v.item.ingredientId } : {}),
    ...(v.item.category ? { category: v.item.category } : {}),
    ticked,
    canUndo: ticked && v.activeEvents.length > 0,
  };
}
