// P3-C (D447-D449): the real Supabase scanner stores against the real migration in PGlite. The desktop store acts as the signed-in
// member (RLS applies); the phone store runs as the `anon` role, which can only call scanner_connect / scanner_push.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPgliteSupabase, type PgliteSupabase } from '../supabase/test-support/pglite-client';
import { SupabaseDesktopScannerStore, SupabasePhoneScannerStore, hashToken } from './store';
import { newScannerToken } from './service';

const ALICE = 'a0000000-0000-4000-8000-000000000001';
const BOB = 'b0000000-0000-4000-8000-000000000002';
const CAROL = 'c0000000-0000-4000-8000-000000000003';
const HA = 'aa000000-0000-4000-8000-0000000000aa';
const HC = 'cc000000-0000-4000-8000-0000000000cc';
const D1 = 'device-one-0123456789';
const D2 = 'device-two-0123456789';

let pg: PgliteSupabase;
const desktop = () => new SupabaseDesktopScannerStore(pg.client);
const phone = () => new SupabasePhoneScannerStore(pg.client);
const as = {
  alice: { householdId: HA, userId: ALICE },
  bob: { householdId: HA, userId: BOB },
  carol: { householdId: HC, userId: CAROL },
};
/** The phone is anonymous. */
async function asPhone() {
  await pg.actAs(null);
  await pg.db.exec('set role anon');
}
const asUser = (id: string) => pg.actAs(id);

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

async function start(who = as.alice) {
  await asUser(who.userId);
  const token = newScannerToken();
  const r = await desktop().create(who, 'pantry', hashToken(token));
  if (!r.ok) throw new Error(r.error);
  return { id: r.id, token, expiresAt: r.expiresAt };
}

describe('SupabaseScannerStore against the real SQL', () => {
  it('create -> phone connects and pushes (anon) -> desktop reads barcodes and a photo -> revoke deletes it all', async () => {
    const s = await start();
    expect(new Date(s.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(s.expiresAt).getTime()).toBeLessThanOrEqual(Date.now() + 10 * 60_000 + 5000);

    await asPhone();
    expect(await phone().connect(s.id, s.token, D1)).toMatchObject({ ok: true, purpose: 'pantry', itemCount: 0 });
    expect(await phone().push(s.id, s.token, D1, { clientId: 'client-000001', kind: 'barcode', barcode: '5000157024671', count: 1 })).toMatchObject({ ok: true, duplicate: false, itemCount: 1 });
    expect(await phone().push(s.id, s.token, D1, { clientId: 'client-000001', kind: 'barcode', barcode: '5000157024671', count: 1 })).toMatchObject({ ok: true, duplicate: true });
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    expect(await phone().push(s.id, s.token, D1, { clientId: 'client-photo-1', kind: 'photo', photo: { mime: 'image/jpeg', bytes } })).toMatchObject({ ok: true, itemCount: 2 });
    expect(await phone().push(s.id, s.token, D2, { clientId: 'client-000002', kind: 'barcode', barcode: '5000157024671' })).toEqual({ ok: false, error: 'scanner_in_use' });
    expect(await phone().connect(s.id, 'x'.repeat(43), D1)).toEqual({ ok: false, error: 'invalid' });

    await asUser(ALICE);
    const st = await desktop().status(as.alice, s.id, 0);
    expect(st.ok && st.session).toMatchObject({ id: s.id, purpose: 'pantry', state: 'connected', itemCount: 2, photoCount: 1 });
    expect(st.ok && st.items.map((i) => [i.kind, i.barcode ?? null, i.count])).toEqual([['barcode', '5000157024671', 1], ['photo', null, 1]]);
    const after = await desktop().status(as.alice, s.id, st.ok ? st.items[0]!.seq : 0);
    expect(after.ok && after.items.map((i) => i.kind)).toEqual(['photo']);
    const photoItem = st.ok ? st.items.find((i) => i.kind === 'photo')! : undefined;
    const p = await desktop().photo(as.alice, photoItem!.id);
    expect(p.ok && p.mime).toBe('image/jpeg');
    expect(p.ok && Buffer.compare(p.bytes, bytes)).toBe(0);

    // Another member of the household, and another household, cannot see or end it.
    await asUser(BOB);
    expect(await desktop().status(as.bob, s.id, 0)).toEqual({ ok: false, error: 'not_found' });
    expect(await desktop().revoke(as.bob, s.id)).toEqual({ ok: false, error: 'not_found' });
    expect(await desktop().photo(as.bob, photoItem!.id)).toEqual({ ok: false, error: 'not_found' });
    await asUser(CAROL);
    expect(await desktop().status(as.carol, s.id, 0)).toEqual({ ok: false, error: 'not_found' });

    await asUser(ALICE);
    expect(await desktop().release(as.alice, s.id)).toEqual({ ok: true });
    await asPhone();
    expect(await phone().connect(s.id, s.token, D2)).toMatchObject({ ok: true });

    await asUser(ALICE);
    expect(await desktop().revoke(as.alice, s.id)).toEqual({ ok: true });
    const gone = await desktop().status(as.alice, s.id, 0);
    expect(gone.ok && gone.session.state).toBe('revoked');
    expect(gone.ok && gone.items).toEqual([]);
    await asPhone();
    expect(await phone().push(s.id, s.token, D2, { clientId: 'client-000009', kind: 'barcode', barcode: '5000157024671' })).toEqual({ ok: false, error: 'revoked' });
    await pg.actAs(null);
    const n = await pg.db.query<{ n: number }>('select count(*)::int as n from public.scanner_photos');
    expect(n.rows[0]!.n).toBe(0);
  });

  it('expires after its time and refuses a household you are not in', async () => {
    const s = await start();
    await pg.admin(`update public.scanner_sessions set expires_at = now() - interval '1 second', created_at = now() - interval '10 minutes' where id = '${s.id}'`);
    await asPhone();
    expect(await phone().connect(s.id, s.token, D1)).toEqual({ ok: false, error: 'expired' });
    expect(await phone().push(s.id, s.token, D1, { clientId: 'client-000001', kind: 'barcode', barcode: '5000157024671' })).toEqual({ ok: false, error: 'expired' });
    await asUser(CAROL);
    expect(await desktop().create({ householdId: HA, userId: CAROL }, 'pantry', hashToken('x'))).toEqual({ ok: false, error: 'forbidden' });
  });

  it('only the hash of the token is stored', async () => {
    const s = await start();
    const rows = await pg.db.query<{ token_hash: string }>(`select token_hash from public.scanner_sessions where id = '${s.id}'`);
    expect(rows.rows[0]!.token_hash).toBe(hashToken(s.token));
    expect(JSON.stringify(rows.rows)).not.toContain(s.token);
  });
});
