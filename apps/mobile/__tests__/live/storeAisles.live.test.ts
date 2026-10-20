/**
 * OPT-IN live check (AS1, D290-D299) of stores / aisles / placements against the LOCAL Supabase stack: real PostgREST, real RLS,
 * the real migration. Writes the way the web repository does (table inserts as the signed-in user), reads through
 * `household_store_book`, copies with `copy_store_layout`, and drives the mobile DataSource (`getStoreBook`, `setPlacement`).
 * `pnpm exec supabase start`, then `pnpm --filter @fr/mobile test:live`. Throw-away users (*.fr-live.test), local only.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { orderForStore } from '@fr/engine/shopping';
import { SupabaseDataSource } from '@/data/supabaseDataSource';
import { OfflineStore, type KeyValueStore } from '@/data/offlineQueue';

const live = process.env.FR_LIVE ? describe : describe.skip;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

function memoryKv(): KeyValueStore {
  const data = new Map<string, string>();
  return { getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => void data.set(k, v), removeItem: async (k) => void data.delete(k) };
}

function stack() {
  const out = execSync('pnpm exec supabase status -o json', { cwd: join(__dirname, '..', '..', '..', '..'), encoding: 'utf8' });
  const s = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)) as Record<string, string>;
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)/.test(s.API_URL ?? '')) throw new Error(`refusing non-local Supabase ${s.API_URL}`);
  return { url: s.API_URL as string, anon: s.ANON_KEY as string, service: s.SERVICE_ROLE_KEY as string };
}

live('store aisles against the local Supabase stack', () => {
  const s = stack();
  const admin = createClient(s.url, s.service, opts);
  let alice: SupabaseClient;
  let carol: SupabaseClient;
  let hhA: string;
  let hhC: string;
  const users: string[] = [];

  async function newUser(tag: string): Promise<SupabaseClient> {
    const email = `as1.${tag}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@fr-live.test`;
    const password = 'Live-Test-Passw0rd!';
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (!created.data.user) throw new Error(`createUser failed: ${JSON.stringify(created.error)}`);
    users.push(created.data.user.id);
    const c = createClient(s.url, s.anon, opts);
    const { error } = await c.auth.signInWithPassword({ email, password });
    expect(error).toBeNull();
    return c;
  }

  beforeAll(async () => {
    alice = await newUser('alice');
    carol = await newUser('carol');
    hhA = ((await alice.from('households').insert({ name: 'AS1 live A' }).select('id').single()).data as { id: string }).id;
    hhC = ((await carol.from('households').insert({ name: 'AS1 live C' }).select('id').single()).data as { id: string }).id;
  });

  afterAll(async () => {
    for (const id of [hhA, hhC]) if (id) await admin.from('households').delete().eq('id', id);
    for (const id of users) await admin.auth.admin.deleteUser(id);
  });

  it('creates a store with aisles and placements, reads the book in one call, orders a list by it', async () => {
    const st = await alice.from('stores').insert({ household_id: hhA, name: 'ALDI Gosforth', chain: 'ALDI' }).select('id').single();
    expect(st.error).toBeNull();
    const storeId = (st.data as { id: string }).id;
    const ai = await alice.from('store_aisles').insert([
      { household_id: hhA, store_id: storeId, label: '1', sort_order: 10 },
      { household_id: hhA, store_id: storeId, label: '5', sort_order: 50 },
    ]).select('id, label');
    expect(ai.error).toBeNull();
    const byLabel = Object.fromEntries((ai.data as Array<{ id: string; label: string }>).map((a) => [a.label, a.id]));
    const pl = await alice.from('store_placements').upsert([
      { household_id: hhA, store_id: storeId, aisle_id: byLabel['1'], target_type: 'ingredient', target_key: 'ing-tomato' },
      { household_id: hhA, store_id: storeId, aisle_id: byLabel['5'], target_type: 'ingredient', target_key: 'ing-milk' },
    ], { onConflict: 'store_id,target_type,target_key' });
    expect(pl.error).toBeNull();

    const ds = new SupabaseDataSource({ client: alice, store: new OfflineStore(memoryKv()) });
    const book = await ds.getStoreBook(hhA);
    expect(book.stores.map((x) => x.name)).toEqual(['ALDI Gosforth']);
    expect(book.aisles.map((a) => a.label)).toEqual(['1', '5']);
    const items = [
      { item: { id: 'm', displayName: 'Milk', category: 'Dairy & eggs', ingredientId: 'ing-milk' } },
      { item: { id: 't', displayName: 'Tomatoes', category: 'Fruit & veg', ingredientId: 'ing-tomato' } },
      { item: { id: 'x', displayName: 'Mystery', category: 'Other' } },
    ];
    const sections = orderForStore(items, book.stores[0]!, book.aisles, book.placements);
    expect(sections.map((x) => [x.label, x.items.map((i) => i.item.id)])).toEqual([['1', ['t']], ['5', ['m']], ['Not placed yet', ['x']]]);

    // quick placement from the phone: upsert replaces, null clears
    await ds.setPlacement(hhA, storeId, { targetType: 'ingredient', targetKey: 'ing-tomato' }, byLabel['5']!);
    let again = await ds.getStoreBook(hhA);
    expect(again.placements.find((p) => p.targetKey === 'ing-tomato')?.aisleId).toBe(byLabel['5']);
    expect(again.placements.filter((p) => p.targetKey === 'ing-tomato')).toHaveLength(1);
    await ds.setPlacement(hhA, storeId, { targetType: 'ingredient', targetKey: 'ing-tomato' }, null);
    again = await ds.getStoreBook(hhA);
    expect(again.placements.some((p) => p.targetKey === 'ing-tomato')).toBe(false);
  });

  it('copy_store_layout replaces the target and keeps placements pointing at the target aisles', async () => {
    const [from, to] = (await alice.from('stores').select('id').eq('household_id', hhA).order('created_at')).data as Array<{ id: string }>;
    const lidl = await alice.from('stores').insert({ household_id: hhA, name: 'LIDL', chain: 'LIDL' }).select('id').single();
    const lidlId = (lidl.data as { id: string }).id;
    const r = await alice.rpc('copy_store_layout', { p_household_id: hhA, p_from_store: from!.id, p_to_store: lidlId });
    expect(r.error).toBeNull();
    expect(r.data).toBe(2);
    const book = (await alice.rpc('household_store_book', { p_household_id: hhA })).data as { aisles: Array<{ id: string; storeId: string }>; placements: Array<{ storeId: string; aisleId: string }> };
    const lidlAisles = new Set(book.aisles.filter((a) => a.storeId === lidlId).map((a) => a.id));
    expect(lidlAisles.size).toBe(2);
    const lidlPlacements = book.placements.filter((p) => p.storeId === lidlId);
    expect(lidlPlacements.length).toBeGreaterThan(0);
    expect(lidlPlacements.every((p) => lidlAisles.has(p.aisleId))).toBe(true);
    void to;
  });

  it('is household isolated through the real RLS', async () => {
    const empty = await carol.rpc('household_store_book', { p_household_id: hhA });
    expect(empty.error).toBeNull();
    expect((empty.data as { stores: unknown[] }).stores).toEqual([]);
    const sneaky = await carol.from('stores').insert({ household_id: hhA, name: 'Sneaky' });
    expect(sneaky.error).not.toBeNull();
    const seen = await carol.from('stores').select('id').eq('household_id', hhA);
    expect(seen.data).toEqual([]);
    const mine = await carol.from('stores').insert({ household_id: hhC, name: 'Carol shop' }).select('id').single();
    expect(mine.error).toBeNull();
    const cross = await carol.rpc('copy_store_layout', { p_household_id: hhC, p_from_store: (await alice.from('stores').select('id').eq('household_id', hhA).limit(1)).data![0]!.id, p_to_store: (mine.data as { id: string }).id });
    expect(cross.error).not.toBeNull(); // another household's store cannot be copied from
  });
});
