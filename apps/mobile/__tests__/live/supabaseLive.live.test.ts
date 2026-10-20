/**
 * OPT-IN live check of SupabaseDataSource against the LOCAL Supabase stack (D215): real Postgres, real RLS, real
 * `shopping_list_snapshot` / `record_purchase` / `void_purchase`, real Realtime. Runs under plain Node via vitest (the
 * jest-expo environment replaces fetch/WebSocket): `pnpm exec supabase start`, then `pnpm --filter @fr/mobile test:live`.
 *
 * Creates throw-away users/households (*.fr-live.test) on the local stack only; refuses any non-local URL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { itemKey } from '@fr/engine/shopping';
import { SupabaseDataSource } from '@/data/supabaseDataSource';
import { OfflineStore, type KeyValueStore } from '@/data/offlineQueue';

const live = process.env.FR_LIVE ? describe : describe.skip;

function memoryKv(): KeyValueStore {
  const data = new Map<string, string>();
  return {
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => void data.set(k, v),
    removeItem: async (k) => void data.delete(k),
  };
}

const until = async (cond: () => boolean | Promise<boolean>, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
};

interface Ctx {
  url: string;
  anon: string;
  admin: SupabaseClient;
}

function stack(): Ctx {
  const out = execSync('pnpm exec supabase status -o json', { cwd: join(__dirname, '..', '..', '..', '..'), encoding: 'utf8' });
  const s = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)) as Record<string, string>;
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)/.test(s.API_URL ?? '')) throw new Error(`refusing non-local Supabase ${s.API_URL}`);
  return {
    url: s.API_URL as string,
    anon: s.ANON_KEY as string,
    admin: createClient(s.API_URL as string, s.SERVICE_ROLE_KEY as string, { auth: { persistSession: false, autoRefreshToken: false } }),
  };
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } };

live('SupabaseDataSource against the local Supabase stack', () => {
  let ctx: Ctx;
  let web: SupabaseClient; // the "web app" writer (same user, separate client)
  let mobile: SupabaseClient;
  let householdId: string;
  let listId: string;
  let userId: string;
  const rpcCalls: string[] = [];

  async function head(): Promise<number> {
    const { data } = await web.rpc('shopping_list_snapshot', { p_household_id: householdId });
    return Number((data as { head: number }).head);
  }

  /** Web-style engine write: add an item through apply_shopping_command (the log row + item upsert in one transaction). */
  async function webAddItem(name: string, qty: { value: number; unit: string } | null) {
    const itemId = randomUUID();
    const quantity = qty ? { kind: 'exact', value: qty.value, unit: qty.unit, originalText: `${qty.value} ${qty.unit}` } : { kind: 'unparsed', originalText: name };
    const at = new Date().toISOString();
    const { data, error } = await web.rpc('apply_shopping_command', {
      p_list_id: listId,
      p_command_id: randomUUID(),
      p_command_type: 'add',
      p_command: { type: 'add_item', itemId, displayName: name, category: 'Other', at, ...(qty ? { quantity } : {}) },
      p_result: { status: 'applied', type: 'add_item', itemId },
      p_items: [
        {
          id: itemId, key: itemKey(undefined, name), displayName: name, ingredientRef: null, category: 'Other', aisle: null, notes: null,
          isManual: true, position: 0, planLinked: false, requirement: null, manualQuantity: quantity, removed: null, quantity,
        },
      ],
      p_expected_head: await head(),
    });
    expect(error).toBeNull();
    expect((data as { status: string }).status).toBe('applied');
    return itemId;
  }

  beforeAll(async () => {
    ctx = stack();
    const email = `m3.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@fr-live.test`;
    const password = 'Live-Test-Passw0rd!';
    const created = await ctx.admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (!created.data.user) throw new Error(`createUser failed: ${JSON.stringify(created.error)}`);
    userId = created.data.user.id;
    web = createClient(ctx.url, ctx.anon, opts);
    mobile = createClient(ctx.url, ctx.anon, opts);
    for (const c of [web, mobile]) {
      const { error } = await c.auth.signInWithPassword({ email, password });
      expect(error).toBeNull();
    }
    const hh = await web.from('households').insert({ name: 'M3 live' }).select('id').single();
    householdId = (hh.data as { id: string }).id;
    const list = await web.rpc('ensure_shopping_list', { p_household_id: householdId });
    listId = list.data as string;
    await webAddItem('Milk', { value: 2, unit: 'l' });
    await webAddItem('Flour', { value: 1, unit: 'kg' });
    await webAddItem('Salt', null);
    const rpc = mobile.rpc.bind(mobile);
    (mobile as unknown as { rpc: typeof mobile.rpc }).rpc = ((fn: string, args?: Record<string, unknown>) => {
      rpcCalls.push(fn);
      return rpc(fn, args);
    }) as typeof mobile.rpc;
  });

  afterAll(async () => {
    await mobile?.removeAllChannels();
    if (userId) await ctx.admin.auth.admin.deleteUser(userId).catch(() => undefined);
  });

  it('loads the list through the snapshot RPC, ticks through record_purchase, and catches up by list_seq', async () => {
    const ds = new SupabaseDataSource({ client: mobile, store: new OfflineStore(memoryKv()) });
    const first = await ds.getShoppingList(householdId);
    expect(first.items.map((i) => i.displayName).sort()).toEqual(['Flour', 'Milk', 'Salt']);
    expect(rpcCalls.filter((f) => f === 'shopping_list_snapshot')).toHaveLength(1);

    const milk = first.items.find((i) => i.displayName === 'Milk')!;
    await ds.tickItem(householdId, milk.id);
    expect(ds.pendingCount()).toBe(0);
    const after = await ds.getShoppingList(householdId);
    expect(after.items.find((i) => i.id === milk.id)).toMatchObject({ ticked: true, canUndo: true });
    const events = await ctx.admin.from('purchase_events').select('id').eq('shopping_list_item_id', milk.id);
    expect(events.data).toHaveLength(1);

    // The web adds an item and a purchase lands from elsewhere: the phone catches up from its cursor, no new snapshot.
    const bread = await webAddItem('Bread', { value: 1, unit: 'item' });
    const synced = await ds.getShoppingList(householdId);
    expect(synced.items.map((i) => i.id)).toContain(bread);
    expect(rpcCalls.filter((f) => f === 'shopping_list_snapshot')).toHaveLength(1);

    await ds.undoTick(householdId, milk.id);
    const undone = await ds.getShoppingList(householdId);
    expect(undone.items.find((i) => i.id === milk.id)).toMatchObject({ ticked: false });
    expect(rpcCalls.filter((f) => f === 'shopping_list_snapshot')).toHaveLength(1);
  });

  it('a cold start with the persisted cursor resumes without a snapshot and sees what the web did meanwhile', async () => {
    const kv = memoryKv();
    const a = new SupabaseDataSource({ client: mobile, store: new OfflineStore(kv) });
    await a.getShoppingList(householdId);
    const snapshots = rpcCalls.filter((f) => f === 'shopping_list_snapshot').length;
    const eggs = await webAddItem('Eggs', { value: 6, unit: 'item' });
    const b = new SupabaseDataSource({ client: mobile, store: new OfflineStore(kv) });
    const s = await b.getShoppingList(householdId);
    expect(s.items.map((i) => i.id)).toContain(eggs);
    expect(rpcCalls.filter((f) => f === 'shopping_list_snapshot')).toHaveLength(snapshots);
  });

  it('Realtime: confirmed subscription, then an INSERT from the web triggers the callback', async () => {
    const ds = new SupabaseDataSource({ client: mobile, store: new OfflineStore(memoryKv()), pollMs: 3_600_000 });
    await ds.getShoppingList(householdId);
    let calls = 0;
    const stop = ds.watchShopping(householdId, () => (calls += 1));
    try {
      expect(await until(() => calls >= 1)).toBe(true); // confirmed-subscription catch-up
      const before = calls;
      const jam = await webAddItem('Jam', { value: 1, unit: 'item' });
      expect(await until(() => calls > before)).toBe(true); // the Realtime INSERT
      const s = await ds.getShoppingList(householdId);
      expect(s.items.map((i) => i.id)).toContain(jam);
    } finally {
      stop();
    }
    expect(userId).toBeTruthy();
  });
});
