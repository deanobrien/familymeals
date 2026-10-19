// Live Supabase, API level: RLS isolation through the REAL PostgREST + JWT verification, the shopping purchase RPCs
// under a real concurrent race, and transfer_ownership. No browser; each test makes its own users and households.
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';
import { adminClient, createConfirmedUser, supabaseUrl, userClient, type LiveUser } from './support/live.js';

test.describe.configure({ mode: 'parallel' });

async function household(c: SupabaseClient, name: string): Promise<string> {
  const { data, error } = await c.from('households').insert({ name }).select('id').single();
  if (error || !data) throw new Error(`create household: ${error?.message}`);
  return data.id as string;
}

async function memberWithHousehold(tag: string, name: string): Promise<{ user: LiveUser & { id: string }; c: SupabaseClient; hid: string }> {
  const user = await createConfirmedUser(tag);
  const c = await userClient(user);
  return { user, c, hid: await household(c, name) };
}

/** A shopping list with one item (2 l of milk), written as a household member through PostgREST. */
async function listWithItem(c: SupabaseClient, hid: string) {
  const { data: list, error: le } = await c.from('shopping_lists').insert({ household_id: hid, name: 'Weekly' }).select('id').single();
  if (le || !list) throw new Error(`create list: ${le?.message}`);
  const { data: item, error: ie } = await c
    .from('shopping_list_items')
    .insert({ shopping_list_id: list.id, household_id: hid, display_name: 'milk', quantity_kind: 'exact', quantity_value: 2, unit: 'l', original_text: '2 l' })
    .select('id')
    .single();
  if (ie || !item) throw new Error(`create item: ${ie?.message}`);
  return { listId: list.id as string, itemId: item.id as string };
}

test('RLS: household B sees nothing of household A and cannot write into it (real PostgREST)', async () => {
  const a = await memberWithHousehold('rls-a', 'A home');
  const b = await memberWithHousehold('rls-b', 'B home');
  const { data: recipe } = await a.c.from('recipes').insert({ household_id: a.hid, title: 'A secret stew' }).select('id').single();
  const { listId, itemId } = await listWithItem(a.c, a.hid);
  await a.c.from('pantry_items').insert({ household_id: a.hid, display_name: 'A rice', quantity_kind: 'exact', quantity_value: 1, unit: 'kg' });

  // Reads: every household-scoped table filters to nothing, by id or wholesale.
  for (const table of ['households', 'household_members', 'recipes', 'shopping_lists', 'shopping_list_items', 'pantry_items', 'meal_plans', 'purchase_events', 'shopping_command_log']) {
    const { data, error } = await b.c.from(table).select('*').eq(table === 'households' ? 'id' : 'household_id', a.hid);
    expect(error, table).toBeNull();
    expect(data ?? [], table).toHaveLength(0);
  }
  const { data: byId } = await b.c.from('recipes').select('id').eq('id', recipe!.id);
  expect(byId ?? []).toHaveLength(0);

  // RPCs: B cannot read A through the security-invoker functions either.
  const { data: listed } = await b.c.rpc('list_recipes', { p_household_id: a.hid, p_user_id: b.user.id, p_query: '' });
  expect((listed as { total: number } | null)?.total ?? 0).toBe(0);
  const { data: got } = await b.c.rpc('get_recipes', { p_household_id: a.hid, p_user_id: b.user.id, p_ids: [recipe!.id] });
  expect(got ?? []).toEqual([]);

  // Writes: inserts into A are refused, updates/deletes affect 0 rows.
  const ins = await b.c.from('recipes').insert({ household_id: a.hid, title: 'Injected' });
  expect(ins.error?.code).toBe('42501');
  const upd = await b.c.from('recipes').update({ title: 'Hacked' }).eq('id', recipe!.id).select('id');
  expect(upd.data ?? []).toHaveLength(0);
  const del = await b.c.from('shopping_lists').delete().eq('id', listId).select('id');
  expect(del.data ?? []).toHaveLength(0);
  const { error: saveErr } = await b.c.rpc('save_recipe', {
    p_household_id: a.hid, p_user_id: b.user.id, p_id: null, p_mode: 'create', p_input: { title: 'x', servings: 2, ingredients: [], steps: [] },
  });
  expect(saveErr).not.toBeNull();

  // Purchase RPCs: a foreign item is indistinguishable from a missing one.
  const tick = await b.c.rpc('record_purchase', { p_event_id: randomUUID(), p_item_id: itemId, p_mode: 'tick' });
  const missing = await b.c.rpc('record_purchase', { p_event_id: randomUUID(), p_item_id: randomUUID(), p_mode: 'tick' });
  expect(tick.error?.code).toBe('P0002');
  expect(tick.error?.message).toBe(missing.error?.message);

  // Membership escalation: B cannot add itself to A.
  const join = await b.c.from('household_members').insert({ household_id: a.hid, user_id: b.user.id, role: 'owner' });
  expect(join.error).not.toBeNull();

  // Anonymous (anon key, no JWT) reads nothing; a forged JWT is rejected by PostgREST.
  const anon = createClient(supabaseUrl(), process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data: anonRows } = await anon.from('recipes').select('id');
  expect(anonRows ?? []).toHaveLength(0);
  const forged = createClient(supabaseUrl(), process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4Iiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQifQ.bad' } },
  });
  const { error: forgedErr } = await forged.from('recipes').select('id');
  expect(forgedErr).not.toBeNull();

  // Sanity: A still sees its own data.
  const { data: own } = await a.c.from('recipes').select('id').eq('id', recipe!.id);
  expect(own ?? []).toHaveLength(1);
});

test('record_purchase: two members tick the same item at the same moment -> exactly one purchase', async () => {
  const a = await memberWithHousehold('race-a', 'Race home');
  // Second member joins through a real invitation.
  const { data: inv } = await a.c.rpc('create_invitation', { p_household_id: a.hid });
  const token = (Array.isArray(inv) ? inv[0] : inv).token as string;
  const bUser = await createConfirmedUser('race-b');
  const b = await userClient(bUser);
  expect((await b.rpc('accept_invitation', { p_token: token })).error).toBeNull();

  for (let round = 0; round < 5; round++) {
    const { itemId } = await listWithItem(a.c, a.hid);
    // Three ticks from each member's session, all in flight at once (distinct command ids = distinct taps).
    const results = await Promise.all(
      [a.c, a.c, a.c, b, b, b].map((c) => c.rpc('record_purchase', { p_event_id: randomUUID(), p_item_id: itemId, p_mode: 'tick' })),
    );
    for (const r of results) expect(r.error).toBeNull();
    const applied = results.filter((r) => r.data.status === 'applied');
    const rejected = results.filter((r) => r.data.status === 'rejected');
    expect(applied).toHaveLength(1);
    expect(rejected).toHaveLength(5);
    for (const r of rejected) {
      expect(r.data.reason).toBe('already_complete');
      expect(r.data.completedBy).toHaveLength(1);
    }
    const { data: events } = await a.c.from('purchase_events').select('id, quantity_value, unit').eq('shopping_list_item_id', itemId);
    expect(events).toHaveLength(1);
    expect(Number(events![0]!.quantity_value)).toBe(2);
    const { data: log } = await a.c.from('shopping_command_log').select('status').eq('command->>itemId', itemId);
    expect((log ?? []).filter((l) => l.status === 'applied')).toHaveLength(1);
    expect(log ?? []).toHaveLength(6);
  }
});

test('record_purchase / void_purchase are idempotent under a concurrent retry of the same command', async () => {
  const a = await memberWithHousehold('idem', 'Idem home');
  const { itemId } = await listWithItem(a.c, a.hid);
  const eventId = randomUUID();
  // The same command delivered three times at once (lost-response retries racing the original).
  const ticks = await Promise.all([0, 1, 2].map(() => a.c.rpc('record_purchase', { p_event_id: eventId, p_item_id: itemId, p_mode: 'tick' })));
  for (const t of ticks) expect(t.error).toBeNull();
  expect(ticks.filter((t) => !t.data.duplicate)).toHaveLength(1);
  expect(ticks.every((t) => t.data.status === 'applied' && t.data.eventId === eventId)).toBe(true);

  // Undo twice with the same void id, and once with a different one: one void, one duplicate, one already_voided.
  const voidId = randomUUID();
  const [v1, v2] = await Promise.all([
    a.c.rpc('void_purchase', { p_void_id: voidId, p_event_id: eventId }),
    a.c.rpc('void_purchase', { p_void_id: voidId, p_event_id: eventId }),
  ]);
  expect([v1.data.status, v2.data.status]).toEqual(['applied', 'applied']);
  expect([v1.data.duplicate, v2.data.duplicate].filter(Boolean)).toHaveLength(1);
  const v3 = await a.c.rpc('void_purchase', { p_void_id: randomUUID(), p_event_id: eventId });
  expect(v3.data).toMatchObject({ status: 'rejected', reason: 'already_voided' });

  // After the undo the item is outstanding again and can be ticked.
  const again = await a.c.rpc('record_purchase', { p_event_id: randomUUID(), p_item_id: itemId, p_mode: 'tick' });
  expect(again.data.status).toBe('applied');
  // purchase_events stay append-only for clients.
  const direct = await a.c.from('purchase_events').update({ actual_price_pence: 1 }).eq('id', eventId).select('id');
  expect(direct.error !== null || (direct.data ?? []).length === 0).toBe(true);
});

test('transfer_ownership over PostgREST: atomic swap, refused for members and during the grace period', async () => {
  const a = await memberWithHousehold('xfer-a', 'Xfer home');
  const { data: inv } = await a.c.rpc('create_invitation', { p_household_id: a.hid });
  const token = (Array.isArray(inv) ? inv[0] : inv).token as string;
  const bUser = await createConfirmedUser('xfer-b');
  const b = await userClient(bUser);
  await b.rpc('accept_invitation', { p_token: token });
  const { data: bMember } = await a.c.from('household_members').select('id').eq('household_id', a.hid).eq('user_id', bUser.id).single();
  const { data: aMember } = await a.c.from('household_members').select('id').eq('household_id', a.hid).eq('user_id', a.user.id).single();

  const notOwner = await b.rpc('transfer_ownership', { p_household_id: a.hid, p_new_owner_member_id: aMember!.id });
  expect(notOwner.error?.code).toBe('42501');

  await a.c.rpc('request_household_deletion', { p_household_id: a.hid });
  const inGrace = await a.c.rpc('transfer_ownership', { p_household_id: a.hid, p_new_owner_member_id: bMember!.id });
  expect(inGrace.error?.code).toBe('42501');
  await a.c.rpc('cancel_household_deletion', { p_household_id: a.hid });

  const ok = await a.c.rpc('transfer_ownership', { p_household_id: a.hid, p_new_owner_member_id: bMember!.id });
  expect(ok.error).toBeNull();
  const { data: roles } = await adminClient().from('household_members').select('user_id, role').eq('household_id', a.hid).eq('status', 'active');
  const byUser = Object.fromEntries((roles ?? []).map((r) => [r.user_id, r.role]));
  expect(byUser).toEqual({ [a.user.id]: 'member', [bUser.id]: 'owner' });
});
