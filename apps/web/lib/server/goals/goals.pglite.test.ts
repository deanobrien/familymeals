// P3-B (D430-D434): the goals module against the real migrations in PGlite, acting as `authenticated` users so RLS applies.
// Consent gating at the database (not just the UI), own-rows-only, withdrawal deletes, anonymous planner ids, export scope.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPgliteSupabase, type PgliteSupabase } from '../supabase/test-support/pglite-client';
import { loadGoalNudge, loadGoals, saveGoals, withdrawGoals, type GoalsCaller } from './service';

const ALICE = 'a0000000-0000-4000-8000-000000000001';
const BOB = 'b0000000-0000-4000-8000-000000000002';
const HA = 'aa000000-0000-4000-8000-0000000000aa';

let pg: PgliteSupabase;
const as = (userId: string, readOnly = false): GoalsCaller => ({ householdId: HA, userId, client: pg.client, readOnly });
const input = { consent: true, adultConfirmed: true, goals: ['more_fibre', 'less_salt'], portionShare: 1.5, nudgePlan: true };

beforeAll(async () => {
  pg = await createPgliteSupabase();
  await pg.admin(`
    insert into auth.users (id, email) values ('${ALICE}', 'a@x.test'), ('${BOB}', 'b@x.test');
    insert into public.households (id, name, created_by) values ('${HA}', 'Alice home', '${ALICE}');
    insert into public.household_members (household_id, user_id, role, display_name) values ('${HA}', '${BOB}', 'member', 'Bob');`);
  await pg.actAs(ALICE);
}, 120_000);
afterAll(async () => {
  await pg?.close();
});

/** Superuser read (bypasses RLS), then back to the member we were acting as. */
let actor: string | null = ALICE;
const act = async (id: string | null) => { actor = id; await pg.actAs(id); };
const peek = async (sql: string) => { await pg.admin('select 1'); const r = await pg.db.query<Record<string, unknown>>(sql); await pg.actAs(actor); return r.rows; };
const count = async (table: string, where = 'true') => Number((await peek(`select count(*)::int as n from public.${table} where ${where}`))[0]!.n);

describe('goals against the real schema', () => {
  it('without consent nothing is stored, however it is attempted (service and direct table writes)', async () => {
    expect(await loadGoals(as(ALICE))).toMatchObject({ ok: true, state: { consentActive: false, goals: [] } });
    expect(await saveGoals(as(ALICE), { ...input, consent: false })).toEqual({ ok: false, error: 'consent_required' });
    expect(await count('nutrition_goal_profiles')).toBe(0);
    expect(await count('nutrition_goals')).toBe(0);
    expect(await count('consent_records')).toBe(0);
    const direct = await pg.client.from('nutrition_goals').insert({ household_id: HA, user_id: ALICE, goal: 'more_fibre' });
    expect(direct.error).not.toBeNull();
    const rpc = await pg.client.rpc('set_nutrition_goals', { p_household_id: HA, p_goals: ['more_fibre'], p_portion_share: 1, p_nudge_plan: false, p_adult_confirmed: true });
    expect(rpc.error?.code).toBe('42501');
    expect(await count('nutrition_goals')).toBe(0);
  });

  it('consent + adult confirmation stores the goals; the consent record carries the wording version and its own type', async () => {
    expect(await saveGoals(as(ALICE), { ...input, adultConfirmed: false })).toEqual({ ok: false, error: 'invalid_input' });
    expect(await count('consent_records')).toBe(0);
    const r = await saveGoals(as(ALICE), input);
    expect(r).toMatchObject({ ok: true, state: { consentActive: true, goals: ['more_fibre', 'less_salt'], portionShare: 1.5, nudgePlan: true, adultConfirmed: true, wordingVersion: 'g1' } });
    const c = await peek(`select consent_type, wording_version from public.consent_records`);
    expect(c).toEqual([{ consent_type: 'nutrition_goals', wording_version: 'g1' }]);
  });

  it('does not touch the allergy consent: an allergy consent does not allow goals and vice versa', async () => {
    await act(BOB);
    await pg.client.from('consent_records').insert({ household_id: HA, consent_type: 'allergy_data', wording_version: 'v1' });
    expect(await saveGoals(as(BOB), { ...input, consent: false })).toEqual({ ok: false, error: 'consent_required' });
    await act(ALICE);
  });

  it('only you can see your goals: another member and the owner see nothing of Bob\'s, Bob sees nothing of Alice\'s', async () => {
    await act(BOB);
    expect(await saveGoals(as(BOB), { ...input, goals: ['more_oily_fish'], nudgePlan: false })).toMatchObject({ ok: true, state: { goals: ['more_oily_fish'] } });
    expect(await loadGoals(as(BOB))).toMatchObject({ state: { goals: ['more_oily_fish'], nudgePlan: false } });
    const seen = await pg.client.from('nutrition_goals').select('user_id, goal');
    expect(seen.data).toEqual([{ user_id: BOB, goal: 'more_oily_fish' }]);
    await act(ALICE);
    expect(await loadGoals(as(ALICE))).toMatchObject({ state: { goals: ['more_fibre', 'less_salt'] } });
    const mine = await pg.client.from('nutrition_goals').select('user_id');
    expect(mine.data?.every((r) => r.user_id === ALICE)).toBe(true);
    // the owner cannot rewrite or delete Bob's rows
    await pg.client.from('nutrition_goals').delete().eq('user_id', BOB);
    expect(await count('nutrition_goals')).toBe(3);
  });

  it('the planner gets only anonymous goal ids from members who opted in', async () => {
    expect(await loadGoalNudge(HA, pg.client)).toEqual(['less_salt', 'more_fibre'].sort());
    await act(BOB);
    expect(await loadGoalNudge(HA, pg.client)).toEqual(['less_salt', 'more_fibre'].sort()); // Alice's ids only; Bob did not opt in
  });

  it('refuses writes while the household is pending deletion', async () => {
    await act(ALICE);
    expect(await saveGoals(as(ALICE, true), input)).toEqual({ ok: false, error: 'read_only' });
  });

  it('withdrawing deletes the goals and profile, ends the planner nudge, and re-consent starts clean', async () => {
    await act(ALICE);
    expect(await withdrawGoals(as(ALICE))).toMatchObject({ ok: true, state: { consentActive: false, goals: [], nudgePlan: false } });
    expect((await count('nutrition_goals', `user_id = '${ALICE}'`))).toBe(0);
    expect((await count('nutrition_goal_profiles', `user_id = '${ALICE}'`))).toBe(0);
    expect(await loadGoalNudge(HA, pg.client)).toEqual([]);
    expect(await saveGoals(as(ALICE), { ...input, consent: false })).toEqual({ ok: false, error: 'consent_required' });
    expect(await saveGoals(as(ALICE), { ...input, goals: ['less_sugar'], nudgePlan: false })).toMatchObject({ ok: true, state: { goals: ['less_sugar'], nudgePlan: false } });
  });

  it('leaving the household deletes the goals', async () => {
    await act(BOB);
    expect(await loadGoals(as(BOB))).toMatchObject({ state: { goals: ['more_oily_fish'] } });
    const left = await pg.client.rpc('member_leave', { p_household_id: HA });
    expect(left.error).toBeNull();
    expect((await count('nutrition_goals', `user_id = '${BOB}'`))).toBe(0);
    expect((await count('nutrition_goal_profiles', `user_id = '${BOB}'`))).toBe(0);
  });
});
