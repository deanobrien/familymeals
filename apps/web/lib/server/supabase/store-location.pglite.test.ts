// P2-A (D390-D392): the real SupabaseStoreLocationRepository against the real migration in PGlite, acting as `authenticated`
// household members so RLS applies. Same contract as the in-memory repository, plus isolation and read-only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocationInput } from '../../stores/locations';
import { storeLocationContract } from '../stores/location-contract';
import { SupabaseStoreBookRepository } from './store-book-repository';
import { SupabaseStoreLocationRepository } from './store-location-repository';
import { createPgliteSupabase, type PgliteSupabase } from './test-support/pglite-client';

const ALICE = 'a0000000-0000-4000-8000-000000000001';
const BOB = 'b0000000-0000-4000-8000-000000000002';
const CAROL = 'c0000000-0000-4000-8000-000000000003';
const HA = 'aa000000-0000-4000-8000-0000000000aa';
const HC = 'cc000000-0000-4000-8000-0000000000cc';

let pg: PgliteSupabase;
const locsFor = (user: string) => new SupabaseStoreLocationRepository(pg.client, user);
const bookFor = (user: string) => new SupabaseStoreBookRepository(pg.client, user);
const here = LocationInput.parse({ lat: 54.97, lng: -1.61, source: 'device' });

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

storeLocationContract('Supabase (PGlite)', async () => {
  await pg.admin('delete from public.stores');
  await pg.actAs(BOB); // a plain member, not the owner
  return { locs: locsFor(BOB), book: bookFor(BOB), household: HA };
});

describe('SupabaseStoreLocationRepository: isolation', () => {
  it('another household cannot read, write or clear ours', async () => {
    await pg.admin('delete from public.stores');
    await pg.actAs(ALICE);
    const s = await bookFor(ALICE).createStore(HA, { name: 'ALDI', chain: null, notes: null });
    await locsFor(ALICE).set(HA, s.id, here);
    await pg.actAs(CAROL);
    const carol = locsFor(CAROL);
    expect(await carol.list(HA)).toEqual([]);
    await expect(carol.set(HA, s.id, LocationInput.parse({ lat: 1, lng: 1, source: 'device' }))).rejects.toBeTruthy();
    await carol.clear(HA, s.id); // RLS: deletes nothing
    await pg.actAs(ALICE);
    expect((await locsFor(ALICE).list(HA)).map((l) => l.lat)).toEqual([54.97]);
  });

  it('a read-only (pending deletion) household cannot change locations but can still read them', async () => {
    await pg.admin('delete from public.stores');
    await pg.actAs(ALICE);
    const s = await bookFor(ALICE).createStore(HA, { name: 'Lidl', chain: null, notes: null });
    await locsFor(ALICE).set(HA, s.id, here);
    await pg.admin(`update public.households set status = 'pending_deletion', deletion_requested_at = now(), purge_after = now() + interval '14 days' where id = '${HA}'`);
    await pg.actAs(BOB);
    await expect(locsFor(BOB).set(HA, s.id, here)).rejects.toBeTruthy();
    expect(await locsFor(BOB).list(HA)).toHaveLength(1);
    await pg.admin(`update public.households set status = 'active', deletion_requested_at = null, purge_after = null where id = '${HA}'`);
  });
});
