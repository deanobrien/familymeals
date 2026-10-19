// S2 contract test (D120-D127): the real Supabase shopping / receipts / prices / profile / AI-settings code against the
// real migrations in PGlite, acting as `authenticated` members so RLS applies. NOT covered: PostgREST itself and the
// Realtime server (see D128).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Command, Quantity, Requirement } from '../../shopping/engine';
import { clientIngest, createClient, defaultEngineContext, deriveAll, emptyState } from '../../shopping/engine';
import { AiSettingsStore } from '../ai/settings-store';
import { syncList } from '../shopping/service';
import { SupabaseSettingsBackend } from './ai-settings-backend';
import type { DataContext } from './backend';
import { PlanLeftoverSource, SupabaseHouseholdProfile, SupabasePurchaseEventSource } from './household-sources';
import { SupabasePriceStore } from './price-store';
import { SupabaseReceiptRepository } from './receipt-repository';
import { SupabaseShoppingRepository, tickRetryId } from './shopping-repository';
import { createPgliteSupabase, type PgliteSupabase } from './test-support/pglite-client';

const ALICE = 'a0000000-0000-4000-8000-000000000001';
const BOB = 'b0000000-0000-4000-8000-000000000002';
const CAROL = 'c0000000-0000-4000-8000-000000000003';
const HA = 'aa000000-0000-4000-8000-0000000000aa';
const HC = 'cc000000-0000-4000-8000-0000000000cc';
const FLOUR = '11000000-0000-4000-8000-000000000001';
const MILK = '11000000-0000-4000-8000-000000000002';
const RECIPE = 'a1000000-0000-4000-8000-000000000001';
const at = '2026-10-19T10:00:00.000Z';

let pg: PgliteSupabase;
const ctx = defaultEngineContext;
const shop = (hh = HA) => new SupabaseShoppingRepository({ client: pg.client, householdId: hh, ctx });
const q = (value: number, unit: Quantity['unit']): Quantity => ({ kind: 'exact', value, unit, originalText: `${value} ${unit}` });
const req = (ingredientId: string, displayName: string, quantity: Quantity): Requirement => ({
  ingredientId, displayName, quantity,
  contributions: [{ recipeId: RECIPE, recipeIngredientId: randomUUID(), quantity }],
});
const base = (actor = ALICE) => ({ commandId: randomUUID(), actor, at });

beforeAll(async () => {
  pg = await createPgliteSupabase();
  await pg.admin(`
    insert into auth.users (id, email) values ('${ALICE}', 'a@x.test'), ('${BOB}', 'b@x.test'), ('${CAROL}', 'c@x.test');
    insert into public.households (id, name, created_by) values ('${HA}', 'Alice home', '${ALICE}'), ('${HC}', 'Carol home', '${CAROL}');
    insert into public.household_members (household_id, user_id, role, display_name) values ('${HA}', '${BOB}', 'member', 'Bob');
    update public.household_members set display_name = 'Alice' where user_id = '${ALICE}';
    insert into public.ingredients (id, name, slug, category, form) values
      ('${FLOUR}', 'Flour', 'flour', 'Baking', null), ('${MILK}', 'Milk', 'milk', 'Dairy', null);
    insert into public.recipes (id, household_id, title) values ('${RECIPE}', '${HA}', 'Pancakes');
    insert into public.recipe_favourites (recipe_id, user_id, household_id) values ('${RECIPE}', '${BOB}', '${HA}');`);
  await pg.actAs(ALICE);
}, 120_000);
afterAll(async () => {
  await pg?.close();
});

describe('SupabaseShoppingRepository against the real schema', () => {
  let flourId = '';
  let milkId = '';
  let tickId = '';

  it('starts empty: cursor 0, no list', async () => {
    const s = await shop().snapshot(HA);
    expect(s.cursor).toBe(0);
    expect(s.state).toEqual(emptyState());
    expect(await shop().head(HA)).toBe(0);
    expect(await shop().entriesSince(HA, 0)).toEqual([]);
  });

  it('regenerate writes engine items (6 dp totals) and one log entry; titles come from the recipes table', async () => {
    flourId = randomUUID();
    milkId = randomUUID();
    const cmd: Command = {
      type: 'regenerate', ...base(),
      lines: [
        { itemId: flourId, requirement: req(FLOUR, 'Flour', q(333.333333, 'g')), category: 'Baking' },
        { itemId: milkId, requirement: req(MILK, 'Milk', q(2, 'l')), category: 'Dairy' },
      ],
    };
    const out = await shop().submit(HA, cmd);
    expect(out.result.status).toBe('applied');
    const s = await shop().snapshot(HA);
    expect(s.cursor).toBe(1);
    expect(s.state.itemOrder).toEqual([flourId, milkId]);
    expect(s.state.items[flourId]).toMatchObject({ key: `ing:${FLOUR}`, planLinked: true, ingredientId: FLOUR, category: 'Baking' });
    expect(s.meta.recipeTitles).toEqual({ [RECIPE]: 'Pancakes' });
    const row = await pg.db.query<{ quantity_value: string; unit: string }>(`select quantity_value, unit from public.shopping_list_items where id = $1`, [flourId]);
    expect(row.rows[0]).toEqual({ quantity_value: '333.333333', unit: 'g' });
  });

  it('a tick is applied by record_purchase with exactly the outstanding amount; nothing is left', async () => {
    tickId = randomUUID();
    const out = await shop().submit(HA, { type: 'tick', ...base(), commandId: tickId, itemId: flourId });
    expect(out).toMatchObject({ duplicate: false, result: { status: 'applied', eventId: tickId } });
    const s = await shop().snapshot(HA);
    const v = deriveAll(s.state, ctx).find((x) => x.item.id === flourId)!;
    expect(v).toMatchObject({ status: 'complete', outstanding: 0, purchased: 333.333333 });
  });

  it('a retry of the same command is a duplicate and appends nothing', async () => {
    const out = await shop().submit(HA, { type: 'tick', ...base(), commandId: tickId, itemId: flourId });
    expect(out.duplicate).toBe(true);
    expect(await shop().head(HA)).toBe(2);
  });

  it("a second shopper's tick on the same item is rejected already_complete and names the winner", async () => {
    await pg.actAs(BOB);
    const out = await shop().submit(HA, { type: 'tick', ...base(BOB), itemId: flourId });
    expect(out.result).toMatchObject({ status: 'rejected', reason: 'already_complete', completedBy: [ALICE] });
    expect(await shop().head(HA)).toBe(3);
    await pg.actAs(ALICE);
  });

  it('the purchase sanity rules are the engine\'s: an incompatible unit is rejected and logged, nothing bought', async () => {
    const out = await shop().submit(HA, { type: 'purchase', ...base(), itemId: milkId, quantity: q(3, 'can') });
    expect(out.result).toMatchObject({ status: 'rejected', reason: 'incompatible_unit' });
    const ev = await pg.db.query(`select 1 from public.purchase_events where id = $1`, [out.result.commandId]);
    expect(ev.rows).toHaveLength(0);
  });

  it('partial purchase + undo round-trip through record_purchase / void_purchase', async () => {
    const buy = await shop().submit(HA, { type: 'purchase', ...base(), itemId: milkId, quantity: q(500, 'ml'), actualPricePence: 65 });
    expect(buy.result.status).toBe('applied');
    let v = deriveAll((await shop().snapshot(HA)).state, ctx).find((x) => x.item.id === milkId)!;
    expect(v).toMatchObject({ status: 'partial', outstanding: 1.5, unit: 'l' });
    const undo = await shop().submit(HA, { type: 'undo', ...base(), eventId: buy.result.eventId! });
    expect(undo.result.status).toBe('applied');
    v = deriveAll((await shop().snapshot(HA)).state, ctx).find((x) => x.item.id === milkId)!;
    expect(v.status).toBe('outstanding');
    const again = await shop().submit(HA, { type: 'undo', ...base(), eventId: buy.result.eventId! });
    expect(again.result).toMatchObject({ status: 'rejected', reason: 'already_voided' });
  });

  it('add (merge into a live item), edit and remove are persisted as engine state', async () => {
    const add = await shop().submit(HA, { type: 'add_item', ...base(), itemId: randomUUID(), displayName: 'Eggs', category: 'Dairy & eggs', quantity: q(6, 'item') });
    const eggs = add.result.itemId!;
    const merged = await shop().submit(HA, { type: 'add_item', ...base(), itemId: randomUUID(), displayName: 'eggs', category: 'Dairy & eggs', quantity: q(6, 'item') });
    expect(merged.result.itemId).toBe(eggs);
    await shop().submit(HA, { type: 'edit_item', ...base(), itemId: eggs, patch: { notes: 'free range', aisle: 'Fridge' } });
    let s = await shop().snapshot(HA);
    expect(s.state.items[eggs]).toMatchObject({ manualQuantity: { value: 12, unit: 'item' }, notes: 'free range', aisle: 'Fridge', planLinked: false });
    await shop().submit(HA, { type: 'remove_item', ...base(), itemId: eggs });
    s = await shop().snapshot(HA);
    expect(s.state.items[eggs]!.removed).toMatchObject({ reason: 'user', by: ALICE });
    const late = await shop().submit(HA, { type: 'tick', ...base(), itemId: eggs });
    expect(late.result).toMatchObject({ status: 'rejected', reason: 'item_removed' });
  });

  it('replaying the whole log on a fresh client reproduces the snapshot (the web/Realtime catch-up path)', async () => {
    const snap = await shop().snapshot(HA);
    const entries = await shop().entriesSince(HA, 0);
    expect(entries.map((e) => e.seq)).toEqual(Array.from({ length: snap.cursor }, (_, i) => i + 1));
    const client = clientIngest(createClient({ cursor: 0, state: emptyState() }), entries, ctx);
    expect(client.cursor).toBe(snap.cursor);
    expect(client.needsResync).toBe(false);
    const view = (st: typeof snap.state) => deriveAll(st, ctx).map((x) => [x.item.id, x.status, x.purchased, x.outstanding, !!x.item.removed]);
    expect(view(client.confirmed)).toEqual(view(snap.state));
    expect(Object.keys(client.confirmed.events).sort()).toEqual(Object.keys(snap.state.events).sort());
    // every logged outcome (applied AND rejected) is known to the replica: pending commands get pruned
    expect(Object.keys(client.confirmed.outcomes).sort()).toEqual(Object.keys(snap.state.outcomes).sort());
    // and a partial catch-up from a cursor returns exactly the tail
    expect((await shop().entriesSince(HA, snap.cursor - 2)).map((e) => e.seq)).toEqual([snap.cursor - 1, snap.cursor]);
  });

  it('syncList over the Supabase repository: apply + catch up in one round trip, actor = session user', async () => {
    const cursor = await shop().head(HA);
    const cmd = { type: 'add_item', commandId: randomUUID(), actor: 'spoofed', at, itemId: randomUUID(), displayName: 'Butter', category: 'Dairy & eggs' };
    const res = await syncList(shop(), HA, [cmd], cursor, ALICE);
    expect(res.results[0]!.status).toBe('applied');
    expect(res.cursor).toBe(cursor + 1);
    expect(res.entries).toHaveLength(1);
    expect(res.entries[0]!.command.actor).toBe(ALICE);
  });

  it('undo of a tick that was retried under a derived id finds the event that exists (D121)', async () => {
    // simulate the retry outcome directly: an event under the derived id of an original command id
    const original = randomUUID();
    const add = await shop().submit(HA, { type: 'add_item', ...base(), itemId: randomUUID(), displayName: 'Jam', category: 'Other', quantity: q(1, 'item') });
    const tick = await shop().submit(HA, { type: 'tick', ...base(), commandId: tickRetryId(original, 1), itemId: add.result.itemId! });
    expect(tick.result.status).toBe('applied');
    const undo = await shop().submit(HA, { type: 'undo', ...base(), eventId: original });
    expect(undo.result).toMatchObject({ status: 'applied', eventId: tickRetryId(original, 1) });
  });

  it('another household sees nothing and cannot write into this list; a mismatched household is refused', async () => {
    await pg.actAs(CAROL);
    expect((await shop(HC).snapshot(HC)).state.itemOrder).toEqual([]);
    const out = await shop(HC).submit(HC, { type: 'tick', ...base(CAROL), itemId: flourId });
    expect(out.result).toMatchObject({ status: 'rejected', reason: 'item_not_found' });
    await expect(shop(HC).snapshot(HA)).rejects.toThrow(/household/);
    // Carol's own list got the rejection; Alice's log is untouched
    await pg.actAs(ALICE);
    const head = await shop().head(HA);
    await pg.actAs(CAROL);
    expect(await shop(HC).head(HC)).toBe(1);
    await pg.actAs(ALICE);
    expect(await shop().head(HA)).toBe(head);
  });
});

describe('receipts, prices, pantry feed, planner profile, AI settings', () => {
  const receiptId = randomUUID();
  const lineId = randomUUID();

  it('receipt round trip: lines, suggestion, reconciliation', async () => {
    await pg.actAs(ALICE);
    const items = (await shop().snapshot(HA)).state;
    const flour = items.itemOrder.find((id) => items.items[id]!.displayName === 'Flour')!;
    const repo = new SupabaseReceiptRepository(pg.client, HA);
    const record = {
      id: receiptId, householdId: HA, retailer: 'Shop', date: '2026-10-18', totalPence: 120, computedPence: 120, createdAt: at,
      status: 'needs_review' as const, orphanDiscountPence: 0, ignored: [], warnings: ['w'],
      lines: [{
        id: lineId, raw: 'FLOUR 1KG 1.20', tokens: ['flour'], description: 'flour', count: 1,
        packQuantity: q(1, 'kg'), pricePence: 120, discountPence: 0, netPence: 120, discountLines: [],
        match: { classification: 'confident' as const, suggestedItemId: flour, candidates: [{ shoppingListItemId: flour, score: 0.9, reasons: [], flags: [] }] },
      }],
    };
    await repo.save(record);
    expect(await repo.get(HA, receiptId)).toEqual(record);
    expect(await repo.list(HA)).toEqual([{ id: receiptId, retailer: 'Shop', date: '2026-10-18', totalPence: 120, status: 'needs_review', lineCount: 1 }]);
    const reconciled = { ...record, status: 'reconciled' as const, reconciliation: { at, purchaseEventIds: [], decisions: [{ lineId, outcome: 'purchase' as const, shoppingListItemId: flour }] } };
    await repo.save(reconciled);
    expect((await repo.get(HA, receiptId))!.status).toBe('reconciled');
    const row = await pg.db.query<{ match_status: string }>(`select match_status from public.receipt_lines where id = $1`, [lineId]);
    expect(row.rows[0]!.match_status).toBe('confirmed');
    expect(await repo.get(HA, 'not-a-uuid')).toBeUndefined();
    await pg.actAs(CAROL);
    expect(await new SupabaseReceiptRepository(pg.client, HC).get(HC, receiptId)).toBeUndefined();
    await pg.actAs(ALICE);
  });

  it('price store: a receipt price is recorded once, served to this household only, and moves the version', async () => {
    const context: DataContext = { client: pg.client, householdId: HA, userId: ALICE };
    let now = 0;
    const store = new SupabasePriceStore([], async () => context, 15_000, () => now);
    await store.refresh(HA);
    const v0 = store.asPriceSource(HA).version();
    const obs = { ingredientId: FLOUR, pricePence: 120, packQuantity: q(1, 'kg'), kind: 'receipt' as const, observedOn: '2026-10-18', source: `receipt:${receiptId}:${lineId}`, retailer: 'Shop' };
    await store.record(HA, [obs, { ...obs, ingredientId: '99000000-0000-4000-8000-000000000009' }]);
    expect(store.asPriceSource(HA).observations()).toEqual([obs]);
    expect(store.asPriceSource(HA).version()).not.toBe(v0);
    const v1 = store.asPriceSource(HA).version();
    await store.record(HA, [obs]); // idempotent
    now = 20_000;
    await store.refresh(HA);
    expect(store.asPriceSource(HA).version()).toBe(v1); // same content -> same version (calculator cache stays valid)
    await expect(store.refresh(HC)).rejects.toThrow(/household/);
  });

  it('pantry purchase feed and open slots', async () => {
    const records = await new SupabasePurchaseEventSource(pg.client, HA).list(HA);
    expect(records.length).toBeGreaterThan(0);
    expect(records.find((r) => r.target.name === 'Flour')).toMatchObject({ target: { householdId: HA, ingredientId: FLOUR } });
    const leftovers = new PlanLeftoverSource({ list: async () => [{ id: 'p1', householdId: HA, weekStart: '2026-10-19', mealTypes: ['dinner'], entries: { '2026-10-19|dinner': { kind: 'eating_out' } }, status: 'approved', updatedAt: at }] as never }, () => '2026-10-20T08:00:00.000Z');
    const slots = await leftovers.listOpenSlots(HA);
    expect(slots.map((s) => s.date)).toEqual(['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
    expect(await leftovers.listBatches()).toEqual([]);
  });

  it('planner profile: members with names, consented exclusions only, per-member favourites', async () => {
    await pg.admin(`insert into public.household_exclusions (household_id, term, kind) values ('${HA}', 'Mushrooms', 'avoid');`);
    await pg.actAs(ALICE);
    const src = new SupabaseHouseholdProfile(pg.client, HA);
    const p = await src.load(HA);
    expect(p).toMatchObject({ id: HA, defaultServings: 4, withheldExclusions: 0, hardExclusions: [{ ingredientName: 'mushrooms', kind: 'dislike' }] });
    expect(p!.members.map((m) => m.displayName).sort()).toEqual(['Alice', 'Bob']);
    expect(await src.favourites(HA, BOB)).toEqual([RECIPE]);
    expect(await src.favourites(HA, ALICE)).toEqual([]);
    expect(await src.favourites(HA, 'm-lauren')).toEqual([]);
    await pg.actAs(CAROL);
    expect(await new SupabaseHouseholdProfile(pg.client, HA).load(HA)).toBeNull();
    await pg.actAs(ALICE);
  });

  it('AI settings: owner saves an encrypted key, any member\'s server request can use it, nobody else can, DB holds ciphertext only', async () => {
    const KEY = 'sk-proj-SuperSecretKeyValue-wxyz';
    const store = () => new AiSettingsStore({ env: { NODE_ENV: 'production', APP_SECRET: 'test-secret-0123456789' }, backend: new SupabaseSettingsBackend(pg.client, HA) });
    await pg.actAs(ALICE);
    expect(await store().save({ provider: 'openai', openai: { apiKey: KEY, model: 'gpt-4o' } })).toMatchObject({ ok: true });
    expect(await store().getKey('openai')).toBe(KEY);
    await pg.actAs(null);
    const raw = await pg.db.query<{ t: string }>(`select row_to_json(s)::text as t from public.household_ai_settings s`);
    expect(raw.rows[0]!.t).not.toContain('SuperSecret');
    expect(raw.rows[0]!.t).toContain('gpt-4o');
    await pg.actAs(BOB);
    expect(await store().getKey('openai')).toBe(KEY);
    expect((await store().getPublic()).keys.openai).toEqual({ hasKey: true, hint: 'sk-…wxyz' });
    expect(await store().save({ provider: 'mock' })).toMatchObject({ ok: false, message: expect.stringMatching(/owner/) });
    // a ciphertext copied into another household's slot does not decrypt there (AAD = household + provider)
    expect(new SupabaseSettingsBackend(pg.client, HC).aad('openai')).not.toBe(new SupabaseSettingsBackend(pg.client, HA).aad('openai'));
    await pg.actAs(CAROL);
    expect(await store().read()).toBeNull();
    await pg.actAs(ALICE);
  });
});
