// P3-A (D425-D428) contract test: SupabaseKidsStore + the service against the real migrations in PGlite, acting as members so RLS and
// the SECURITY DEFINER RPCs apply (another household sees nothing and cannot vote; a closed round is final).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPgliteSupabase, type PgliteSupabase } from '../supabase/test-support/pglite-client';
import { addKid, castVote, closeRound, openRound, votePreference, type KidsCaller } from './service';
import { SupabaseKidsStore } from './store';

const DAD = 'd0000000-0000-4000-8000-000000000004';
const MUM = 'e0000000-0000-4000-8000-000000000005';
const OUT = 'c0000000-0000-4000-8000-000000000003';
const HD = 'dd000000-0000-4000-8000-0000000000dd';
const HO = 'cc000000-0000-4000-8000-0000000000cc';
const R = [1, 2, 3, 4].map((n) => `e3000000-0000-4000-8000-00000000000${n}`);

let pg: PgliteSupabase;
const as = (userId: string, householdId: string): KidsCaller => ({ householdId, userId, client: pg.client, readOnly: false });

beforeAll(async () => {
  pg = await createPgliteSupabase();
  await pg.admin(`
    insert into auth.users (id, email) values ('${DAD}', 'd@x.test'), ('${MUM}', 'm@x.test'), ('${OUT}', 'o@x.test');
    insert into public.households (id, name, created_by) values ('${HD}', 'Dad home', '${DAD}'), ('${HO}', 'Other home', '${OUT}');
    insert into public.household_members (household_id, user_id, role, display_name) values ('${HD}', '${MUM}', 'member', 'Mum');
    insert into public.recipes (id, household_id, title) values
      ('${R[0]}', '${HD}', 'Fish fingers'), ('${R[1]}', '${HD}', 'Pizza'), ('${R[2]}', '${HD}', 'Tacos'), ('${R[3]}', '${HD}', 'Lasagne');`);
}, 120_000);
afterAll(async () => {
  await pg?.close();
});

describe('kids\' mode on the real schema', () => {
  let kidId = '';
  let roundId = '';

  it('either parent adds a kid profile; only a name, emoji and colour are stored', async () => {
    await pg.actAs(MUM);
    const r = await addKid(as(MUM, HD), { displayName: 'Mia', avatar: '🦊', colour: 'blue' });
    if (!r.ok) throw new Error(r.message);
    kidId = r.kid.id;
    await pg.actAs(null);
    const cols = await pg.db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'kid_profiles' order by 1`);
    expect(cols.rows.map((c) => c.column_name)).toEqual(['avatar', 'colour', 'created_at', 'created_by', 'display_name', 'household_id', 'id', 'updated_at']);
  });

  it('opens a round (3 to 6 of this household\'s recipes) and takes member and kid votes', async () => {
    await pg.actAs(DAD);
    expect(await openRound(as(DAD, HD), { recipeIds: R.slice(0, 2) })).toMatchObject({ ok: false, error: 'invalid_input' });
    const o = await openRound(as(DAD, HD), { recipeIds: R.slice(0, 3), forDate: '2026-10-21', title: 'Tonight', closesAt: new Date(Date.now() + 3_600_000).toISOString() });
    if (!o.ok) throw new Error(o.message);
    roundId = o.roundId;
    expect((await castVote(as(DAD, HD), { roundId, recipeId: R[0], kidId, value: 'heart' })).ok).toBe(true);
    expect((await castVote(as(DAD, HD), { roundId, recipeId: R[0], kidId, value: 'up' })).ok).toBe(true); // replaces
    expect((await castVote(as(DAD, HD), { roundId, recipeId: R[1], value: 'up' })).ok).toBe(true);
    await pg.actAs(MUM);
    expect((await castVote(as(MUM, HD), { roundId, recipeId: R[1], value: 'heart' })).ok).toBe(true);
    expect(await castVote(as(MUM, HD), { roundId, recipeId: R[3], value: 'up' })).toMatchObject({ ok: false, error: 'not_found' });
    const rows = await new SupabaseKidsStore(pg.client).listRounds(HD, 5);
    expect(rows[0]!.candidateIds).toEqual(R.slice(0, 3));
    expect(rows[0]!.votes).toHaveLength(3);
  });

  it('another household sees nothing and cannot vote or close', async () => {
    await pg.actAs(OUT);
    expect(await new SupabaseKidsStore(pg.client).listRounds(HD, 5)).toEqual([]);
    expect(await new SupabaseKidsStore(pg.client).listKids(HD)).toEqual([]);
    expect(await castVote(as(OUT, HO), { roundId, recipeId: R[0], value: 'up' })).toMatchObject({ ok: false, error: 'not_found' });
    expect(await closeRound(as(OUT, HO), roundId)).toMatchObject({ ok: false, error: 'not_found' });
  });

  it('closing is final and feeds the planner as a preference, best first', async () => {
    await pg.actAs(DAD);
    expect(await votePreference(as(DAD, HD), ['2026-10-21'])).toEqual([]); // open: no effect yet
    expect((await closeRound(as(DAD, HD), roundId)).ok).toBe(true);
    expect(await castVote(as(DAD, HD), { roundId, recipeId: R[2], value: 'up' })).toMatchObject({ ok: false, error: 'round_closed' });
    // pizza: up 1 + heart 2 = 3; fish fingers: up 1 = 1
    expect(await votePreference(as(DAD, HD), ['2026-10-20', '2026-10-21', '2026-10-22'])).toEqual([R[1], R[0]]);
    expect(await votePreference(as(DAD, HD), ['2026-11-20'])).toEqual([]);
    await pg.actAs(OUT);
    expect(await votePreference(as(OUT, HO), ['2026-10-21'])).toEqual([]);
  });

  it('a round past its closing time is closed without anyone pressing the button', async () => {
    await pg.actAs(DAD);
    const o = await openRound(as(DAD, HD), { recipeIds: R.slice(0, 3), forDate: '2026-10-28', closesAt: new Date(Date.now() + 3_600_000).toISOString() });
    if (!o.ok) throw new Error(o.message);
    await pg.admin(`update public.dinner_rounds set closes_at = now() - interval '1 minute', created_at = now() - interval '2 days' where id = '${o.roundId}'`);
    await pg.actAs(DAD);
    expect(await castVote(as(DAD, HD), { roundId: o.roundId, recipeId: R[0], value: 'up' })).toMatchObject({ ok: false, error: 'round_closed' });
  });

  it('removing a kid removes their votes', async () => {
    await pg.actAs(DAD);
    const { removeKid } = await import('./service');
    expect((await removeKid(as(DAD, HD), kidId)).ok).toBe(true);
    await pg.actAs(null);
    const left = await pg.db.query<{ n: number }>(`select count(*)::int as n from public.dinner_round_votes where voter_kid_id is not null`);
    expect(left.rows[0]!.n).toBe(0);
  });
});
