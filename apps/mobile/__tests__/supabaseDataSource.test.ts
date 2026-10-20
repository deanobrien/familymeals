import { SupabaseDataSource, conflictMessage, toDataSourceError } from '@/data/supabaseDataSource';
import { OfflineStore, type KeyValueStore } from '@/data/offlineQueue';
import { FakeBackend, HH, USER_ME, USER_SAM, uid } from './helpers/fakeSupabase';

function memoryKv(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => void data.set(k, v),
    removeItem: async (k) => void data.delete(k),
  };
}

function setup(backend = new FakeBackend(), kv = memoryKv()) {
  let n = 1000;
  const make = () =>
    new SupabaseDataSource({
      client: backend.asClient(),
      store: new OfflineStore(kv),
      newId: () => uid(n++),
      now: () => new Date('2026-10-19T12:00:00Z'),
    });
  return { backend, kv, ds: make(), make };
}

const ids = { milk: uid(1), eggs: uid(2), flour: uid(3), salt: uid(4) };

describe('SupabaseDataSource: auth, households, recipes', () => {
  it('signs in/out and exposes the access token for the web API', async () => {
    const { ds } = setup();
    await expect(ds.signIn('dean@example.com', 'wrong')).rejects.toThrow('That email and password did not match');
    await expect(ds.signIn('dean@example.com', 'secret1')).resolves.toMatchObject({ userId: USER_ME });
    await expect(ds.getAccessToken()).resolves.toBe('access-token-123');
    await expect(ds.getSession()).resolves.toMatchObject({ email: 'dean@example.com' });
  });

  it('lists households with active member counts', async () => {
    const { ds } = setup();
    await expect(ds.listHouseholds()).resolves.toEqual([{ id: HH, name: 'The Smiths', memberCount: 2 }]);
  });

  it('lists active recipes and maps detail with Unknown (never 0) nutrition', async () => {
    const b = new FakeBackend();
    b.tables.recipes!.push(
      { id: uid(50), household_id: HH, title: 'Chilli', default_servings: 4, diet_category: 'vegan', status: 'active' },
      { id: uid(51), household_id: HH, title: 'Old draft', default_servings: 2, diet_category: null, status: 'draft' },
    );
    b.tables.ingredients!.push({ id: uid(60), name: 'Kidney beans' });
    b.tables.recipe_ingredients!.push(
      { id: uid(70), recipe_id: uid(50), ingredient_id: uid(60), original_text: '2 cans kidney beans', quantity_kind: 'exact', quantity_value: 2, unit: 'can', position: 0, optional: false, preparation: 'drained' },
      { id: uid(71), recipe_id: uid(50), ingredient_id: null, original_text: 'a pinch of chilli flakes', quantity_kind: 'unparsed', position: 1, optional: true },
    );
    b.tables.recipe_steps!.push(
      { recipe_id: uid(50), step_number: 2, instructions: 'Simmer.' },
      { recipe_id: uid(50), step_number: 1, instructions: 'Combine.' },
    );
    b.tables.nutrition_profiles!.push({ id: uid(80), recipe_id: uid(50), basis: 'per_serving', calculated_at: '2026-10-01T00:00:00Z' });
    b.tables.nutrition_profile_values!.push(
      { nutrition_profile_id: uid(80), nutrient: 'energy_kcal', value_status: 'known', value: '310.0000', unit: 'kcal', estimate: false },
      { nutrition_profile_id: uid(80), nutrient: 'fibre', value_status: 'unknown', value: null, unit: 'g', estimate: false },
      { nutrition_profile_id: uid(80), nutrient: 'fat', value_status: 'zero', value: 0, unit: 'g', estimate: false },
    );
    const { ds } = setup(b);
    const list = await ds.listRecipes(HH);
    expect(list.map((r) => r.title)).toEqual(['Chilli']);

    const r = await ds.getRecipe(uid(50));
    expect(r?.steps).toEqual(['Combine.', 'Simmer.']);
    expect(r?.ingredients[0]).toMatchObject({ name: 'Kidney beans', preparation: 'drained', quantity: { kind: 'exact', value: 2 } });
    // Unmatched line keeps the author's text and does not repeat a quantity.
    expect(r?.ingredients[1]).toMatchObject({ name: 'a pinch of chilli flakes', optional: true, quantity: { originalText: '' } });
    expect(r?.nutrition.find((n) => n.nutrient === 'energy_kcal')).toMatchObject({ status: 'known', value: 310 });
    expect(r?.nutrition.find((n) => n.nutrient === 'fibre')?.value).toBeUndefined();
    expect(r?.nutrition.find((n) => n.nutrient === 'fat')).toMatchObject({ status: 'zero', value: 0 });
    await expect(ds.getRecipe(uid(999))).resolves.toBeNull();
  });
});

describe('SupabaseDataSource: shopping list', () => {
  it('derives the list from rows (aisle-sorted, nothing ticked)', async () => {
    const { ds } = setup();
    const s = await ds.getShoppingList(HH);
    expect(s.items.map((i) => i.displayName)).toEqual(['Flour', 'Salt', 'Eggs', 'Milk']);
    expect(s.items.every((i) => !i.ticked)).toBe(true);
    expect(s.pendingItemIds).toEqual([]);
  });

  it('ticks online through record_purchase with the command id and engine-expected outstanding', async () => {
    const { ds, backend } = setup();
    await ds.getShoppingList(HH);
    const ev = await ds.tickItem(HH, ids.milk);
    expect(ev).toMatchObject({ shoppingListItemId: ids.milk, createdBy: USER_ME, quantity: { value: 2, unit: 'l' } });
    expect(backend.rpcCalls).toHaveLength(1);
    expect(backend.rpcCalls[0]).toMatchObject({
      fn: 'record_purchase',
      args: { p_event_id: ev.id, p_item_id: ids.milk, p_mode: 'tick', p_expected_outstanding: 2, p_expected_event_count: 0 },
    });
    expect(ds.pendingCount()).toBe(0);
    const s = await ds.getShoppingList(HH);
    expect(s.items.find((i) => i.id === ids.milk)).toMatchObject({ ticked: true, canUndo: true });
    expect(backend.tables.purchase_events).toHaveLength(1);
  });

  it('refuses a tick on an already complete item locally', async () => {
    const { ds } = setup();
    await ds.getShoppingList(HH);
    await ds.tickItem(HH, ids.milk);
    await expect(ds.tickItem(HH, ids.milk)).rejects.toThrow('Nothing left to buy');
  });

  it('cold start offline shows the cached list with queued ticks applied, then replays', async () => {
    const { ds, backend, kv, make } = setup();
    await ds.getShoppingList(HH);
    ds.setOnline(false);
    backend.offline = true;
    const ev = await ds.tickItem(HH, ids.eggs);
    expect(JSON.parse(kv.data.get(`fr.shopping.v2.pending.${HH}`) as string)).toHaveLength(1);

    // App restart with no signal: fresh instance, same AsyncStorage.
    const restarted = make();
    restarted.setOnline(false);
    const s = await restarted.getShoppingList(HH);
    expect(s.items.find((i) => i.id === ids.eggs)).toMatchObject({ ticked: true });
    expect(s.pendingItemIds).toEqual([ids.eggs]);
    expect(restarted.pendingCount()).toBe(1);

    // Reconnect: replay once.
    backend.offline = false;
    restarted.setOnline(true);
    await expect(restarted.flushPending()).resolves.toBe(1);
    expect(backend.rpcCalls).toHaveLength(1);
    expect(backend.rpcCalls[0]?.args.p_event_id).toBe(ev.id);
    expect(restarted.pendingCount()).toBe(0);
    expect(kv.data.has(`fr.shopping.v2.pending.${HH}`)).toBe(false);
    await expect(restarted.flushPending()).resolves.toBe(0);
    expect(backend.tables.purchase_events).toHaveLength(1);
    expect((await restarted.getShoppingList(HH)).items.find((i) => i.id === ids.eggs)).toMatchObject({ ticked: true });
  });

  it('is idempotent when the server applied the tick but the response was lost', async () => {
    const { ds, backend } = setup();
    await ds.getShoppingList(HH);
    backend.dropRpcResponses = 1;
    await ds.tickItem(HH, ids.milk);
    expect(ds.pendingCount()).toBe(1); // unacknowledged, kept
    expect(backend.tables.purchase_events).toHaveLength(1); // server did apply it
    await expect(ds.flushPending()).resolves.toBe(1); // duplicate answer counts as applied
    expect(backend.tables.purchase_events).toHaveLength(1); // still one event
    expect(backend.rpcCalls.map((c) => c.args.p_event_id)).toEqual([backend.rpcCalls[0]?.args.p_event_id, backend.rpcCalls[0]?.args.p_event_id]);
    expect(ds.pendingCount()).toBe(0);
  });

  it('turns a lost race into a conflict naming who got there first', async () => {
    const { ds, backend } = setup();
    await ds.getShoppingList(HH);
    ds.setOnline(false);
    await ds.tickItem(HH, ids.milk); // my offline tick
    backend.otherUserTick(ids.milk, uid(5000)); // Sam ticks the same item first
    ds.setOnline(true);
    await expect(ds.flushPending()).resolves.toBe(0);
    const conflicts = ds.takeConflicts();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ itemId: ids.milk, itemName: 'Milk', message: 'Sam already got Milk.' });
    expect(ds.takeConflicts()).toEqual([]);
    expect(ds.pendingCount()).toBe(0);
    expect(backend.tables.purchase_events).toHaveLength(1); // one purchase, no double-buy
    const s = await ds.getShoppingList(HH);
    expect(s.items.find((i) => i.id === ids.milk)?.ticked).toBe(true);
  });

  it('catches up from the log cursor without refetching items', async () => {
    const { ds, backend } = setup();
    await ds.getShoppingList(HH);
    const snapshots = backend.snapshotCalls;
    backend.otherUserTick(ids.eggs, uid(5001));
    backend.otherUserPurchase(ids.flour, uid(5002), 400, 'g');
    const s = await ds.getShoppingList(HH);
    expect(backend.snapshotCalls).toBe(snapshots); // incremental (list_seq log query), not a new snapshot
    expect(s.items.find((i) => i.id === ids.eggs)?.ticked).toBe(true);
    const flour = s.items.find((i) => i.id === ids.flour);
    expect(flour?.ticked).toBe(false);
    expect(flour?.quantity).toMatchObject({ value: 0.6, unit: 'kg' }); // 1 kg - 400 g still outstanding
  });

  it('replays engine-written commands from the web (add_item) off the log, no snapshot', async () => {
    const { ds, backend } = setup();
    await ds.getShoppingList(HH);
    const snapshots = backend.snapshotCalls;
    backend.appendLog(
      uid(5003),
      'add',
      { type: 'add_item', itemId: uid(77), displayName: 'Bread', category: 'Bakery', aisle: 'Bakery', at: '2026-10-19T09:00:00Z', actor: USER_SAM },
      { status: 'applied', type: 'add_item', itemId: uid(77) },
    );
    const s = await ds.getShoppingList(HH);
    expect(backend.snapshotCalls).toBe(snapshots);
    expect(s.items.map((i) => i.displayName)).toContain('Bread');
  });

  it('undoes a tick through void_purchase', async () => {
    const { ds, backend } = setup();
    await ds.getShoppingList(HH);
    await ds.tickItem(HH, ids.milk);
    await ds.undoTick(HH, ids.milk);
    expect(backend.rpcCalls.map((c) => c.fn)).toEqual(['record_purchase', 'void_purchase']);
    expect(backend.tables.purchase_events![0]?.voided_at).toBeTruthy();
    const s = await ds.getShoppingList(HH);
    expect(s.items.find((i) => i.id === ids.milk)).toMatchObject({ ticked: false });
    await expect(ds.undoTick(HH, ids.milk)).rejects.toThrow('Nothing to undo');
  });

  it('re-issues a tick under a new id after needs_engine_outstanding (stale event count)', async () => {
    const { ds, backend } = setup();
    await ds.getShoppingList(HH);
    ds.setOnline(false);
    await ds.tickItem(HH, ids.flour); // engine thinks 1 kg outstanding, 0 events
    backend.otherUserPurchase(ids.flour, uid(5004), 200, 'g'); // server moved on; SQL cannot convert 'g' -> unit? it can; force mismatch
    // Make the fake server unable to convert so it demands the engine value (mixed unit family).
    backend.tables.purchase_events![0]!.unit = 'cup';
    ds.setOnline(true);
    await expect(ds.flushPending()).resolves.toBe(1);
    const calls = backend.rpcCalls.filter((c) => c.fn === 'record_purchase');
    expect(calls).toHaveLength(2);
    expect(calls[1]?.args.p_event_id).not.toBe(calls[0]?.args.p_event_id);
    expect(calls[1]?.args.p_expected_event_count).toBe(1);
    expect(ds.takeConflicts()).toEqual([]);
    expect(ds.pendingCount()).toBe(0);
  });

  it('reports a final server error once instead of retrying forever', async () => {
    const { ds, backend } = setup();
    await ds.getShoppingList(HH);
    backend.rpcError = { code: 'P0002', message: 'item_not_found' };
    await ds.tickItem(HH, ids.milk);
    expect(ds.pendingCount()).toBe(0);
    expect(ds.takeConflicts()[0]?.message).toBe('Milk is no longer on the list.');
  });

  it('keeps commands queued on a transient failure', async () => {
    const { ds, backend } = setup();
    await ds.getShoppingList(HH);
    backend.offline = true; // ds.online still true (NetInfo not yet told)
    await ds.tickItem(HH, ids.milk);
    expect(ds.pendingCount()).toBe(1);
    expect(ds.takeConflicts()).toEqual([]);
  });
});

describe('error + message helpers', () => {
  it('classifies retryable errors', () => {
    expect(toDataSourceError({ message: 'TypeError: Network request failed', code: '' }).retryable).toBe(true);
    expect(toDataSourceError({ message: 'x', code: 'PGRST001' }).retryable).toBe(true);
    expect(toDataSourceError({ message: 'insufficient', code: '42501' }).retryable).toBe(false);
  });
  it('words conflicts', () => {
    expect(conflictMessage('Milk', 'already_complete', ['Sam', 'Sam'])).toBe('Sam already got Milk.');
    expect(conflictMessage('Milk', 'already_complete', [])).toBe('Milk was already bought.');
    expect(conflictMessage('Milk', 'already_voided', [])).toBe('That purchase was already undone.');
    expect(USER_SAM).toBeTruthy();
  });
});

describe('OfflineStore', () => {
  it('drops corrupt entries instead of throwing', async () => {
    const kv = memoryKv();
    const store = new OfflineStore(kv);
    kv.data.set(`fr.shopping.v2.pending.${HH}`, '{not json');
    await expect(store.loadPending(HH)).resolves.toEqual([]);
    kv.data.set(`fr.shopping.v2.pending.${HH}`, JSON.stringify([{ nope: 1 }, { commandId: 'a', type: 'tick' }]));
    await expect(store.loadPending(HH)).resolves.toHaveLength(1);
    kv.data.set(`fr.shopping.v2.active.${HH}`, JSON.stringify({ listId: uid(200) }));
    kv.data.set(`fr.shopping.v2.list.${uid(200)}`, '[]');
    await expect(store.loadSnapshot(HH)).resolves.toBeNull();
  });
});
