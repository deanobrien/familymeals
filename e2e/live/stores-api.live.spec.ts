// Live Supabase, API level (LT1, D230): the S2 / X2 stores that had only PGlite coverage, through the REAL PostgREST
// + JWT + RLS: receipts, price observations, pantry purchase feed, planner household profile (consent), product
// snapshots. Every test creates its own users and households, so runs are independent and parallel-safe.
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminClient, createConfirmedUser, userClient, type LiveUser } from './support/live.js';

test.describe.configure({ mode: 'parallel' });

type Member = { user: LiveUser & { id: string }; c: SupabaseClient };

async function member(tag: string): Promise<Member> {
  const user = await createConfirmedUser(tag);
  return { user, c: await userClient(user) };
}

async function household(m: Member, name: string): Promise<string> {
  const { data, error } = await m.c.from('households').insert({ name }).select('id').single();
  if (error || !data) throw new Error(`create household: ${error?.message}`);
  return data.id as string;
}

async function join(owner: Member, hid: string, joiner: Member): Promise<void> {
  const { data: inv, error } = await owner.c.rpc('create_invitation', { p_household_id: hid });
  if (error) throw new Error(`create_invitation: ${error.message}`);
  const token = (Array.isArray(inv) ? inv[0] : inv).token as string;
  const r = await joiner.c.rpc('accept_invitation', { p_token: token });
  if (r.error) throw new Error(`accept_invitation: ${r.error.message}`);
}

async function ingredientId(name: string): Promise<string> {
  const { data, error } = await adminClient().from('ingredients').select('id').eq('name', name).limit(1).single();
  if (error || !data) throw new Error(`reference ingredient "${name}" missing (seed not applied?): ${error?.message}`);
  return data.id as string;
}

/** A list with one ingredient-linked item (500 g red lentils), written as a member through PostgREST. */
async function listWithLentils(m: Member, hid: string, ingredient: string) {
  const { data: list, error: le } = await m.c.from('shopping_lists').insert({ household_id: hid, name: 'Weekly' }).select('id').single();
  if (le || !list) throw new Error(`create list: ${le?.message}`);
  const { data: item, error: ie } = await m.c
    .from('shopping_list_items')
    .insert({ shopping_list_id: list.id, household_id: hid, ingredient_id: ingredient, display_name: 'Red lentils', quantity_kind: 'exact', quantity_value: 500, unit: 'g', original_text: '500 g' })
    .select('id')
    .single();
  if (ie || !item) throw new Error(`create item: ${ie?.message}`);
  return { listId: list.id as string, itemId: item.id as string };
}

const g = (n: number) => ({ kind: 'exact', value: n, unit: 'g', originalText: `${n} g` });

function receiptPayload(receiptId: string, lineId: string, itemId: string | null, status: 'parsed' | 'reconciled' = 'parsed') {
  return {
    p_receipt: {
      id: receiptId, retailer: 'Example Supermarket', purchasedOn: '2026-10-19', totalPence: 189, status,
      reconciledAt: status === 'reconciled' ? new Date().toISOString() : null,
      reviewState: { computedPence: 189, imageName: 'r.png', createdAt: new Date().toISOString(), orphanDiscountPence: 0, ignored: [], warnings: [], reconciliation: null },
    },
    p_lines: [{
      id: lineId, lineNo: 1, description: 'RED LENTILS 500G', quantity: g(500), unitPricePence: 189, lineTotalPence: 189,
      matchStatus: itemId ? 'confirmed' : 'unmatched', matchedItemId: itemId, matchScore: itemId ? 0.9 : null, addedToPantry: false,
      parsed: { id: lineId, raw: 'RED LENTILS 500G 1.89', description: 'RED LENTILS 500G' },
    }],
  };
}

test('receipts: save / list / get round trip, confirm -> purchase_event + price observation, household B unaffected', async () => {
  const a = await member('rc-a');
  const b = await member('rc-b');
  const hidA = await household(a, 'Receipt home A');
  const hidB = await household(b, 'Receipt home B');
  const lentils = await ingredientId('red lentils');
  const { itemId } = await listWithLentils(a, hidA, lentils);

  // Save (needs_review), list, get.
  const receiptId = randomUUID();
  const lineId = randomUUID();
  const save = await a.c.rpc('save_receipt', { p_household_id: hidA, ...receiptPayload(receiptId, lineId, itemId) });
  expect(save.error).toBeNull();
  expect(save.data).toBe(receiptId);
  const list = await a.c.rpc('list_receipts', { p_household_id: hidA });
  expect(list.data).toHaveLength(1);
  expect(list.data[0]).toMatchObject({ id: receiptId, retailer: 'Example Supermarket', total_pence: 189, status: 'parsed', line_count: 1 });
  const got = await a.c.rpc('get_receipt', { p_household_id: hidA, p_receipt_id: receiptId });
  expect(got.data.receipt).toMatchObject({ id: receiptId, status: 'parsed' });
  expect(got.data.receipt.review_state.imageName).toBe('r.png');
  expect(got.data.lines).toHaveLength(1);
  expect(got.data.lines[0]).toMatchObject({ id: lineId, match_status: 'confirmed', matched_shopping_list_item_id: itemId, unit_price_pence: 189 });
  expect(got.data.lines[0].parsed.raw).toBe('RED LENTILS 500G 1.89');

  // Confirm: the purchase (tied to the receipt line) and the receipt price observation.
  const buy = await a.c.rpc('record_purchase', { p_event_id: randomUUID(), p_item_id: itemId, p_mode: 'purchase', p_qty: g(500), p_price_pence: 189, p_receipt_line_id: lineId });
  expect(buy.error).toBeNull();
  expect(buy.data.status).toBe('applied');
  const obs = { ingredientId: lentils, retailer: 'Example Supermarket', pricePence: 189, quantity: g(500), kind: 'receipt', observedOn: '2026-10-19', source: `receipt:${receiptId}:${lineId}`, receiptLineId: lineId };
  const rec = await a.c.rpc('record_price_observations', { p_household_id: hidA, p_items: [obs] });
  expect(rec.error).toBeNull();
  expect(rec.data).toBe(1);
  // Re-recording the same source + ingredient is idempotent.
  expect((await a.c.rpc('record_price_observations', { p_household_id: hidA, p_items: [obs] })).data).toBe(0);
  // Reconcile the receipt (second save of the same id updates in place).
  expect((await a.c.rpc('save_receipt', { p_household_id: hidA, ...receiptPayload(receiptId, lineId, itemId, 'reconciled') })).error).toBeNull();
  expect((await a.c.rpc('list_receipts', { p_household_id: hidA })).data[0].status).toBe('reconciled');

  const { data: events } = await a.c.from('purchase_events').select('receipt_line_id, actual_price_pence, voided_at').eq('household_id', hidA);
  expect(events).toHaveLength(1);
  expect(events![0]).toMatchObject({ receipt_line_id: lineId, actual_price_pence: 189, voided_at: null });

  // A sees its own price observation (kind receipt, ranked above generic by the engine); B sees none of it.
  const mine = await a.c.rpc('household_price_observations', { p_household_id: hidA });
  const own = (mine.data as Array<{ ingredient_id: string; kind: string; price_pence: number; household_id: string | null }>).filter((p) => p.household_id === hidA);
  expect(own).toHaveLength(1);
  expect(own[0]).toMatchObject({ ingredient_id: lentils, kind: 'receipt', price_pence: 189 });
  const theirs = await b.c.rpc('household_price_observations', { p_household_id: hidB });
  expect((theirs.data as Array<{ household_id: string | null }>).filter((p) => p.household_id !== null)).toHaveLength(0);
  // Shared generic estimates are deliberately not returned (the app adds refdata itself).
  expect((mine.data as Array<{ kind: string }>).some((p) => p.kind === 'generic_estimate')).toBe(false);

  // B cannot read, list, overwrite or price against A's data, and the same ids stay A's.
  expect((await b.c.rpc('get_receipt', { p_household_id: hidA, p_receipt_id: receiptId })).data ?? null).toBeNull();
  expect((await b.c.rpc('list_receipts', { p_household_id: hidA })).data).toEqual([]);
  expect((await b.c.rpc('list_receipts', { p_household_id: hidB })).data).toEqual([]);
  const hijack = await b.c.rpc('save_receipt', { p_household_id: hidB, ...receiptPayload(receiptId, randomUUID(), null) });
  expect(hijack.error).not.toBeNull(); // same receipt id under B's household: refused, A's row untouched
  const intoA = await b.c.rpc('save_receipt', { p_household_id: hidA, ...receiptPayload(randomUUID(), randomUUID(), null) });
  expect(intoA.error).not.toBeNull();
  const priceIntoA = await b.c.rpc('record_price_observations', { p_household_id: hidA, p_items: [{ ...obs, source: `receipt:x:${lineId}` }] });
  expect(priceIntoA.error).not.toBeNull();
  const after = await a.c.rpc('get_receipt', { p_household_id: hidA, p_receipt_id: receiptId });
  expect(after.data.receipt.status).toBe('reconciled');
  expect(after.data.receipt.household_id).toBe(hidA);

  // A suggestion pointing at ANOTHER household's item is stored unmatched (no cross-household reference).
  const { itemId: bItem } = await listWithLentils(b, hidB, lentils);
  const foreign = randomUUID();
  const foreignLine = randomUUID();
  expect((await a.c.rpc('save_receipt', { p_household_id: hidA, ...receiptPayload(foreign, foreignLine, bItem) })).error).toBeNull();
  const f = await a.c.rpc('get_receipt', { p_household_id: hidA, p_receipt_id: foreign });
  expect(f.data.lines[0]).toMatchObject({ match_status: 'unmatched', matched_shopping_list_item_id: null });
});

test('prices: unknown ingredients are skipped; user_confirmed ok; generic / retailer rows cannot be written by a household', async () => {
  const a = await member('pr-a');
  const hid = await household(a, 'Price home');
  const lentils = await ingredientId('red lentils');
  const ok = await a.c.rpc('record_price_observations', {
    p_household_id: hid,
    p_items: [
      { ingredientId: lentils, retailer: null, pricePence: 150, quantity: g(500), kind: 'user_confirmed', observedOn: '2026-10-19', source: 'typed:1', receiptLineId: null },
      { ingredientId: randomUUID(), retailer: null, pricePence: 99, quantity: g(500), kind: 'user_confirmed', observedOn: '2026-10-19', source: 'typed:2', receiptLineId: null },
      { ingredientId: lentils, retailer: null, pricePence: 1, quantity: g(500), kind: 'generic_estimate', observedOn: '2026-10-19', source: 'typed:3', receiptLineId: null },
    ],
  });
  expect(ok.error).toBeNull();
  expect(ok.data).toBe(1); // unknown ingredient and the generic_estimate row were not stored
  const direct = await a.c.from('ingredient_prices').insert({
    household_id: hid, ingredient_id: lentils, price_pence: 1, quantity_kind: 'exact', quantity_value: 500, unit: 'g', kind: 'generic_estimate', observed_on: '2026-10-19', source: 'x',
  });
  expect(direct.error).not.toBeNull();
  const shared = await a.c.from('ingredient_prices').insert({
    household_id: null, ingredient_id: lentils, price_pence: 1, quantity_kind: 'exact', quantity_value: 500, unit: 'g', kind: 'retailer_verified', observed_on: '2026-10-19', source: 'x',
  });
  expect(shared.error).not.toBeNull();
});

test("pantry purchase feed: only this household's purchases, with what they were for", async () => {
  const a = await member('pf-a');
  const b = await member('pf-b');
  const hidA = await household(a, 'Feed home A');
  const hidB = await household(b, 'Feed home B');
  const lentils = await ingredientId('red lentils');
  const { itemId } = await listWithLentils(a, hidA, lentils);
  const { itemId: bItem } = await listWithLentils(b, hidB, lentils);

  expect((await a.c.rpc('record_purchase', { p_event_id: randomUUID(), p_item_id: itemId, p_mode: 'purchase', p_qty: g(200), p_price_pence: 80 })).data.status).toBe('applied');
  expect((await a.c.rpc('record_purchase', { p_event_id: randomUUID(), p_item_id: itemId, p_mode: 'tick' })).data.status).toBe('applied');
  expect((await b.c.rpc('record_purchase', { p_event_id: randomUUID(), p_item_id: bItem, p_mode: 'tick' })).data.status).toBe('applied');

  const feed = await a.c.rpc('household_purchase_records', { p_household_id: hidA });
  expect(feed.error).toBeNull();
  const rows = feed.data as Array<{ event: { household_id: string; quantity_value: number | string }; item: { display_name: string; ingredient_id: string } }>;
  expect(rows).toHaveLength(2);
  for (const r of rows) {
    expect(r.event.household_id).toBe(hidA);
    expect(r.item).toMatchObject({ display_name: 'Red lentils', ingredient_id: lentils });
  }
  expect(rows.map((r) => Number(r.event.quantity_value)).sort((x, y) => x - y)).toEqual([200, 300]); // 200 bought, the tick takes the remaining 300

  // B asking for A's feed gets nothing (RLS on the invoker function), and its own feed holds only its own tick.
  expect((await b.c.rpc('household_purchase_records', { p_household_id: hidA })).data).toEqual([]);
  expect(((await b.c.rpc('household_purchase_records', { p_household_id: hidB })).data as unknown[]).length).toBe(1);
});

test('planner profile: members, consent-gated exclusions, withdraw consent withholds them; favourites are per member', async () => {
  const owner = await member('pp-o');
  const second = await member('pp-m');
  const outsider = await member('pp-x');
  const hid = await household(owner, 'Profile home');
  await join(owner, hid, second);
  await owner.c.from('household_members').update({ display_name: 'Olive' }).eq('household_id', hid).eq('user_id', owner.user.id);

  // No consent yet: an allergy cannot even be recorded (trigger), an 'avoid' preference can.
  const noConsent = await owner.c.from('household_exclusions').insert({ household_id: hid, term: 'Peanuts', kind: 'allergy', consent_recorded_at: new Date().toISOString() });
  expect(noConsent.error?.code).toBe('42501');
  expect((await owner.c.from('household_exclusions').insert({ household_id: hid, term: 'Coriander', kind: 'avoid' })).error).toBeNull();

  const p0 = (await owner.c.rpc('planner_household_profile', { p_household_id: hid })).data;
  expect(p0.members.map((m: { displayName: string }) => m.displayName)).toContain('Olive');
  expect(p0.members).toHaveLength(2);
  expect(p0.exclusions).toEqual([{ name: 'coriander', kind: 'avoid' }]);
  expect(p0.withheldExclusions).toBe(0);

  // Owner consents and records an allergy (term), and an intolerance for a whole allergen group.
  const consent = await owner.c.from('consent_records').insert({ household_id: hid, consent_type: 'allergy_data', wording_version: 'v1' });
  expect(consent.error).toBeNull();
  const now = new Date().toISOString();
  expect((await owner.c.from('household_exclusions').insert({ household_id: hid, term: 'Peanuts', kind: 'allergy', consent_recorded_at: now })).error).toBeNull();
  expect((await owner.c.from('household_exclusions').insert({ household_id: hid, allergen_group: 'milk', kind: 'intolerance', consent_recorded_at: now })).error).toBeNull();

  // Any active member sees the usable exclusions (the planner needs them), expanded for allergen groups.
  for (const m of [owner, second]) {
    const p = (await m.c.rpc('planner_household_profile', { p_household_id: hid })).data;
    const names = (p.exclusions as Array<{ name: string; kind: string }>).map((e) => `${e.kind}:${e.name}`);
    expect(names).toContain('allergy:peanuts');
    expect(names).toContain('avoid:coriander');
    // The group name is returned. `ingredient_allergens` is not seeded (the refdata catalogue has no allergen column,
    // D132), so SQL adds no per-ingredient names today; the app's keyword resolver expands the group from the name.
    expect(names).toContain('intolerance:milk');
    expect(p.withheldExclusions).toBe(0);
  }

  // Favourites: written as oneself only (no spoofing another member); readable by the household's members only.
  const { data: recipe } = await owner.c.from('recipes').insert({ household_id: hid, title: 'Fav stew' }).select('id').single();
  expect((await owner.c.from('recipe_favourites').insert({ recipe_id: recipe!.id, household_id: hid })).error).toBeNull();
  const mine = await owner.c.from('recipe_favourites').select('recipe_id').eq('household_id', hid).eq('user_id', owner.user.id);
  expect((mine.data ?? []).map((r) => r.recipe_id)).toEqual([recipe!.id]);
  const theirs = await second.c.from('recipe_favourites').select('recipe_id').eq('household_id', hid).eq('user_id', owner.user.id);
  expect((theirs.data ?? []).map((r) => r.recipe_id)).toEqual([recipe!.id]); // household-readable: the planner's "favourites of Olive" needs it
  const spoof = await second.c.from('recipe_favourites').insert({ recipe_id: recipe!.id, household_id: hid, user_id: owner.user.id });
  expect(spoof.error).not.toBeNull();

  // Outsider: no profile at all.
  expect((await outsider.c.rpc('planner_household_profile', { p_household_id: hid })).data ?? null).toBeNull();

  // Withdraw consent: the allergy / intolerance rows are withheld (counted), the 'avoid' row stays.
  const w = await owner.c.from('consent_records').update({ withdrawn_at: new Date().toISOString() }).eq('household_id', hid).eq('user_id', owner.user.id).is('withdrawn_at', null).select('id');
  expect(w.error).toBeNull();
  expect(w.data).toHaveLength(1);
  const p1 = (await second.c.rpc('planner_household_profile', { p_household_id: hid })).data;
  expect(p1.exclusions).toEqual([{ name: 'coriander', kind: 'avoid' }]);
  expect(p1.withheldExclusions).toBe(2);

  // Consent given by a DIFFERENT member does not re-enable the owner's rows (consent is per recorder).
  expect((await second.c.from('consent_records').insert({ household_id: hid, consent_type: 'allergy_data', wording_version: 'v1' })).error).toBeNull();
  expect((await owner.c.rpc('planner_household_profile', { p_household_id: hid })).data.withheldExclusions).toBe(2);
});

test('product snapshots: confirm stores one snapshot per household; the other household cannot read, write or delete it', async () => {
  const a = await member('ps-a');
  const second = await member('ps-m');
  const b = await member('ps-b');
  const hidA = await household(a, 'Snapshot home A');
  const hidB = await household(b, 'Snapshot home B');
  await join(a, hidA, second);
  const lentils = await ingredientId('red lentils');
  const barcode = '5000000000017';
  const snap = (name: string, code = barcode) => ({
    barcode: code, name, packSize: { value: 500, unit: 'g' }, nutritionPer100: { energyKcal: { value: 330, status: 'known' } }, allergens: [], attribution: { source: 'openfoodfacts' },
  });
  const at = () => new Date().toISOString();

  expect((await a.c.rpc('save_product_snapshot', { p_household_id: hidA, p_barcode: barcode, p_ingredient_id: lentils, p_snapshot: snap('Lentils v1'), p_retrieved_at: at() })).error).toBeNull();
  // Re-confirm: upsert, still one row.
  expect((await a.c.rpc('save_product_snapshot', { p_household_id: hidA, p_barcode: barcode, p_ingredient_id: lentils, p_snapshot: snap('Lentils v2'), p_retrieved_at: at() })).error).toBeNull();
  const listed = (await a.c.rpc('household_product_snapshots', { p_household_id: hidA })).data as Array<{ barcode: string; ingredient_id: string; snapshot: { name: string } }>;
  expect(listed).toHaveLength(1);
  expect(listed[0]).toMatchObject({ barcode, ingredient_id: lentils });
  expect(listed[0]!.snapshot.name).toBe('Lentils v2');

  // Another member of the SAME household reads it; household B reads nothing, writes nothing, deletes nothing.
  expect((await second.c.rpc('household_product_snapshots', { p_household_id: hidA })).data).toHaveLength(1);
  expect((await b.c.rpc('household_product_snapshots', { p_household_id: hidA })).data ?? null).toBeNull();
  expect((await b.c.rpc('household_product_snapshots', { p_household_id: hidB })).data).toEqual([]);
  const into = await b.c.rpc('save_product_snapshot', { p_household_id: hidA, p_barcode: barcode, p_ingredient_id: null, p_snapshot: snap('Injected'), p_retrieved_at: at() });
  expect(into.error?.code).toBe('42501');
  expect((await b.c.rpc('delete_product_snapshot', { p_household_id: hidA, p_barcode: barcode })).error?.code).toBe('42501');
  // B can hold the same barcode independently; A's row is untouched.
  expect((await b.c.rpc('save_product_snapshot', { p_household_id: hidB, p_barcode: barcode, p_ingredient_id: null, p_snapshot: snap('B own'), p_retrieved_at: at() })).error).toBeNull();
  expect((await a.c.rpc('household_product_snapshots', { p_household_id: hidA })).data[0].snapshot.name).toBe('Lentils v2');
  // The table is closed to direct access; malformed snapshots and bad barcodes are refused.
  expect((await a.c.from('household_product_snapshots').select('barcode')).error).not.toBeNull();
  expect((await a.c.rpc('save_product_snapshot', { p_household_id: hidA, p_barcode: '123', p_ingredient_id: null, p_snapshot: snap('x', '123'), p_retrieved_at: at() })).error).not.toBeNull();
  expect((await a.c.rpc('save_product_snapshot', { p_household_id: hidA, p_barcode: '5000000000024', p_ingredient_id: null, p_snapshot: snap('mismatch'), p_retrieved_at: at() })).error?.code).toBe('22023');
  // Delete is scoped to the household.
  expect((await second.c.rpc('delete_product_snapshot', { p_household_id: hidA, p_barcode: barcode })).error).toBeNull();
  expect((await a.c.rpc('household_product_snapshots', { p_household_id: hidA })).data).toEqual([]);
  expect((await b.c.rpc('household_product_snapshots', { p_household_id: hidB })).data).toHaveLength(1);
});
