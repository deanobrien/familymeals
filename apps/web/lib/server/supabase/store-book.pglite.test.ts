// AS1 (D290-D293): the real SupabaseStoreBookRepository against the real migration in PGlite, acting as `authenticated`
// household members so RLS applies. Same contract as the in-memory repository, plus isolation. NOT covered: PostgREST
// argument typing / header handling (see D128); the local-Supabase live test covers the real PostgREST.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { storeBookContract } from '../stores/contract';
import { SupabaseStoreBookRepository, bookFromJson } from './store-book-repository';
import { createPgliteSupabase, type PgliteSupabase } from './test-support/pglite-client';

const ALICE = 'a0000000-0000-4000-8000-000000000001';
const BOB = 'b0000000-0000-4000-8000-000000000002';
const CAROL = 'c0000000-0000-4000-8000-000000000003';
const HA = 'aa000000-0000-4000-8000-0000000000aa';
const HC = 'cc000000-0000-4000-8000-0000000000cc';

let pg: PgliteSupabase;
const repoFor = (user: string) => new SupabaseStoreBookRepository(pg.client, user);

beforeAll(async () => {
  pg = await createPgliteSupabase();
  await pg.admin(`
    insert into auth.users (id, email) values ('${ALICE}', 'a@x.test'), ('${BOB}', 'b@x.test'), ('${CAROL}', 'c@x.test');
    insert into public.households (id, name, created_by) values ('${HA}', 'Alice home', '${ALICE}'), ('${HC}', 'Carol home', '${CAROL}');
    insert into public.household_members (household_id, user_id, role, display_name) values ('${HA}', '${BOB}', 'member', 'Bob');`);
}, 120_000);
afterAll(async () => {
  await pg?.close();
});

// one shared household, wiped between tests (stores cascade to aisles and placements)
storeBookContract('Supabase (PGlite)', async () => {
  await pg.admin('delete from public.stores');
  await pg.actAs(BOB); // a plain member, not the owner
  return { repo: repoFor(BOB), household: HA };
});

describe('SupabaseStoreBookRepository: isolation and robustness', () => {
  it('another household cannot read or change ours', async () => {
    await pg.admin('delete from public.stores');
    await pg.actAs(ALICE);
    const s = await repoFor(ALICE).createStore(HA, { name: 'ALDI', chain: null, notes: null });
    await pg.actAs(CAROL);
    const carol = repoFor(CAROL);
    expect(await carol.book(HA)).toEqual({ stores: [], aisles: [], placements: [] });
    await expect(carol.createStore(HA, { name: 'Sneaky', chain: null, notes: null })).rejects.toBeTruthy();
    await expect(carol.updateStore(HA, s.id, { name: 'Hacked' })).rejects.toBeTruthy(); // RLS hides the row: nothing updated
    await carol.deleteStore(HA, s.id); // RLS: deletes nothing
    await pg.actAs(ALICE);
    expect((await repoFor(ALICE).book(HA)).stores.map((x) => x.name)).toEqual(['ALDI']);
    expect((await carol.book(HC)).stores).toEqual([]);
  });

  it('a read-only household (pending deletion) can read but not write', async () => {
    await pg.admin('delete from public.stores');
    await pg.actAs(ALICE);
    await repoFor(ALICE).createStore(HA, { name: 'Before', chain: null, notes: null });
    await pg.admin(`update public.households set status = 'pending_deletion', deletion_requested_at = now(), purge_after = now() + interval '14 days' where id = '${HA}'`);
    try {
      await pg.actAs(ALICE); // admin() above ran as the superuser
      await expect(repoFor(ALICE).createStore(HA, { name: 'After', chain: null, notes: null })).rejects.toBeTruthy();
      expect((await repoFor(ALICE).book(HA)).stores.map((s) => s.name)).toEqual(['Before']);
    } finally {
      await pg.admin(`update public.households set status = 'active', deletion_requested_at = null, purge_after = null where id = '${HA}'`);
    }
  });

  it('drops malformed rows from the book payload', () => {
    expect(bookFromJson(null)).toEqual({ stores: [], aisles: [], placements: [] });
    const b = bookFromJson({
      stores: [{ id: 's', name: 'S' }, { id: 'x' }],
      aisles: [{ id: 'a', storeId: 's', label: '1', sortOrder: 10 }, { id: 'b' }],
      placements: [{ storeId: 's', aisleId: 'a', targetType: 'category', targetKey: 'Bakery' }, { storeId: 's', aisleId: 'a', targetType: 'bogus', targetKey: 'x' }],
    });
    expect(b.stores).toHaveLength(1);
    expect(b.aisles).toHaveLength(1);
    expect(b.placements).toHaveLength(1);
  });
});
