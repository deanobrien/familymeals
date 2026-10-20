// P0-D (D350): the shared settings module against the real migrations in PGlite, acting as `authenticated` users so RLS applies.
// Covers the rules both web and Android rely on: owner-only preferences, consent before exclusions, withdrawal stops the
// planner applying them (planner_household_profile) and the withheld count the consent notice shows.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SupabaseHouseholdProfile } from '../supabase/household-sources';
import { createPgliteSupabase, type PgliteSupabase } from '../supabase/test-support/pglite-client';
import { removeAllDietary, saveDietary, savePreferences, withdrawConsent, loadSettings, type SettingsCaller } from './service';

const ALICE = 'a0000000-0000-4000-8000-000000000001';
const BOB = 'b0000000-0000-4000-8000-000000000002';
const HA = 'aa000000-0000-4000-8000-0000000000aa';

let pg: PgliteSupabase;
const as = (userId: string, readOnly = false): SettingsCaller => ({ householdId: HA, userId, client: pg.client, readOnly });
const prefs = { currency: 'GBP', locale: 'en-GB', units: 'metric', defaultServings: '6', weeklyBudget: '85.50' };

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

const planner = async () => (await new SupabaseHouseholdProfile(pg.client, HA).load(HA))!;

describe('settings against the real schema', () => {
  it('an owner saves servings and budget; the values persist', async () => {
    const r = await savePreferences(as(ALICE), prefs);
    expect(r).toMatchObject({ ok: true, settings: { defaultServings: 6, weeklyBudgetPence: 8550 } });
    expect(await loadSettings(as(ALICE))).toMatchObject({ ok: true, settings: { defaultServings: 6, weeklyBudgetPence: 8550 } });
    expect(await planner()).toMatchObject({ defaultServings: 6, weeklyBudgetPence: 8550 });
  });

  it('a member cannot change household preferences (RLS)', async () => {
    await pg.actAs(BOB);
    expect(await savePreferences(as(BOB), { ...prefs, defaultServings: '2' })).toEqual({ ok: false, error: 'forbidden' });
    await pg.actAs(ALICE);
    expect(await loadSettings(as(ALICE))).toMatchObject({ settings: { defaultServings: 6 } });
  });

  it('refuses invalid values with field errors and does not write', async () => {
    const r = await savePreferences(as(ALICE), { ...prefs, defaultServings: '0' });
    expect(r).toMatchObject({ ok: false, error: 'invalid_input', fieldErrors: { defaultServings: expect.any(String) } });
    expect(await loadSettings(as(ALICE))).toMatchObject({ settings: { defaultServings: 6 } });
  });

  it('refuses writes while the household is pending deletion', async () => {
    expect(await savePreferences(as(ALICE, true), prefs)).toEqual({ ok: false, error: 'read_only' });
  });

  it('exclusions need consent; with consent they are stored, recorded and applied by the planner', async () => {
    expect(await saveDietary(as(ALICE), { tags: ['peanuts'], consent: false })).toMatchObject({ ok: false, error: 'invalid_input', fieldErrors: { consent: expect.any(String) } });
    const r = await saveDietary(as(ALICE), { tags: [' Peanuts ', 'sesame'], consent: true });
    expect(r).toMatchObject({ ok: true, settings: { exclusions: ['peanuts', 'sesame'], consentActive: true, withheldExclusions: 0 } });
    const p = await planner();
    expect(p.hardExclusions.map((e) => e.ingredientName).sort()).toEqual(['peanuts', 'sesame']);
    // idempotent: saving the same list again changes nothing and keeps ONE active consent
    expect(await saveDietary(as(ALICE), { tags: ['peanuts', 'sesame'], consent: true })).toMatchObject({ ok: true, settings: { exclusions: ['peanuts', 'sesame'] } });
  });

  it('consent is per member: Bob sees the list but has no consent of his own', async () => {
    await pg.actAs(BOB);
    expect(await loadSettings(as(BOB))).toMatchObject({ ok: true, settings: { exclusions: ['peanuts', 'sesame'], consentActive: false, withheldExclusions: 0 } });
    await pg.actAs(ALICE);
  });

  it('withdrawing consent keeps the list but the planner stops applying it and the notice counts it', async () => {
    const r = await withdrawConsent(as(ALICE));
    expect(r).toMatchObject({ ok: true, settings: { exclusions: ['peanuts', 'sesame'], consentActive: false, withheldExclusions: 2 } });
    const p = await planner();
    expect(p.hardExclusions).toEqual([]);
    expect(p.withheldExclusions).toBe(2);
  });

  it('re-consenting applies them again; remove-all deletes the list and withdraws consent', async () => {
    expect(await saveDietary(as(ALICE), { tags: ['peanuts', 'sesame'], consent: true })).toMatchObject({ ok: true, settings: { consentActive: true, withheldExclusions: 0 } });
    expect((await planner()).hardExclusions).toHaveLength(2);
    expect(await removeAllDietary(as(ALICE))).toMatchObject({ ok: true, settings: { exclusions: [], consentActive: false, withheldExclusions: 0 } });
    expect((await planner()).hardExclusions).toEqual([]);
  });
});
