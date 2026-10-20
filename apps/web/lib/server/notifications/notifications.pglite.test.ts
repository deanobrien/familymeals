// P1-C (D380-D389): the notification service and the job's database port against the real migrations in PGlite.
// User paths run as `authenticated` members (RLS applies); the job port runs as the superuser (service role stand-in).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPgliteSupabase, type PgliteSupabase } from '../supabase/test-support/pglite-client';
import { runNotifyJob } from './job';
import { fakeSender } from './senders';
import { loadActivity, loadCentre, loadSettings, markRead, registerDevice, saveSettings, sendTest, type NotificationCaller } from './service';
import { supabaseNotifyJobDb } from './supabase-job-db';
import { defaultSettings } from './types';

const ALICE = 'a0000000-0000-4000-8000-000000000001';
const BOB = 'b0000000-0000-4000-8000-000000000002';
const HA = 'aa000000-0000-4000-8000-0000000000aa';
const ITEM = '11000000-0000-4000-8000-000000000001';
const PHONE = 'ExponentPushToken[alicephone01]';

let pg: PgliteSupabase;
const as = (userId: string): NotificationCaller => ({ householdId: HA, userId, client: pg.client, readOnly: false });

beforeAll(async () => {
  pg = await createPgliteSupabase();
  await pg.admin(`
    insert into auth.users (id, email) values ('${ALICE}', 'a@x.test'), ('${BOB}', 'b@x.test');
    insert into public.households (id, name, created_by) values ('${HA}', 'Alice home', '${ALICE}');
    insert into public.household_members (household_id, user_id, role, display_name) values ('${HA}', '${BOB}', 'member', 'Bob');
    update public.household_members set display_name = 'Alice' where user_id = '${ALICE}';
    insert into public.pantry_items (id, household_id, display_name, quantity_kind, quantity_value, unit, expires_on)
      values ('${ITEM}', '${HA}', 'Chicken', 'exact', 500, 'g', current_date + 1);`);
}, 120_000);
afterAll(async () => {
  await pg?.close();
});

describe('notifications against the real schema', () => {
  it('settings round-trip as the member; another member cannot see them', async () => {
    await pg.actAs(ALICE);
    const next = { ...defaultSettings(), quietStart: '22:00', quietEnd: '06:30', types: { ...defaultSettings().types, recipe_added: { inApp: true, push: false } } };
    const saved = await saveSettings(as(ALICE), next);
    expect(saved).toMatchObject({ ok: true, settings: { quietStart: '22:00', quietEnd: '06:30', types: { recipe_added: { inApp: true, push: false } } } });
    await pg.actAs(BOB);
    expect(await loadSettings(as(BOB))).toMatchObject({ ok: true, settings: { quietStart: '21:30' }, devices: { web: 0, android: 0 } });
  });

  it('device registration and an immediate test push as the user, recorded via complete_test_push', async () => {
    await pg.actAs(ALICE);
    expect(await registerDevice(as(ALICE), { platform: 'android', channel: 'expo', token: PHONE, label: 'Pixel' })).toEqual({ ok: true, devices: { web: 0, android: 1 } });
    const expo = fakeSender('expo');
    expect(await sendTest(as(ALICE), { expo: expo.sender })).toEqual({ ok: true, outcome: 'sent' });
    expect(expo.sent.map((s) => s.target.token)).toEqual([PHONE]);
    expect(await sendTest(as(ALICE), { expo: expo.sender })).toEqual({ ok: false, error: 'rate_limited' });
    const c = await loadCentre(as(ALICE));
    expect(c).toMatchObject({ ok: true, centre: { unread: 1, items: [{ type: 'test', read: false }] } });
    expect(await markRead(as(ALICE))).toEqual({ ok: true, unread: 0 });
    await pg.actAs(BOB);
    expect(await loadCentre(as(BOB))).toMatchObject({ ok: true, centre: { unread: 0, items: [] } });
  });

  it('the activity feed is derived from existing tables', async () => {
    await pg.admin(`insert into public.recipes (household_id, title, created_by) values ('${HA}', 'Soup', '${BOB}');`);
    await pg.actAs(ALICE);
    const r = await loadActivity(as(ALICE), 10);
    expect(r.ok && r.events.find((e) => e.type === 'recipe_added')).toMatchObject({ actor: 'Bob', text: 'added the recipe Soup', mine: false });
    expect(r.ok && r.events.find((e) => e.type === 'member_joined' && e.mine)).toMatchObject({ actor: 'You' });
  });

  it('the job (service role): expiry alert per member, push to registered devices, idempotent', async () => {
    await pg.actAs(null);
    const db = supabaseNotifyJobDb(pg.client);
    // Late morning in London, so both members are past their morning hour whatever the test machine's clock says.
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date(`${today}T11:00:00Z`);
    const expo = fakeSender('expo');
    const r1 = await runNotifyJob({ db, senders: { expo: expo.sender }, now: () => now });
    expect(r1.failedSteps).toEqual([]);
    expect(r1.created.expiry).toBe(2);
    expect(r1.push).toMatchObject({ sent: 1, noDevices: 1 });
    expect(expo.sent[0]!.message.body).not.toContain('Chicken');
    const r2 = await runNotifyJob({ db, senders: { expo: expo.sender }, now: () => new Date(now.getTime() + 60_000) });
    expect(r2.created.expiry).toBe(0);
    expect(expo.sent).toHaveLength(1);
    const attempts = await pg.db.query<{ n: number }>(`select count(*)::int as n from public.notification_delivery_attempts`);
    expect(attempts.rows[0]!.n).toBe(1);

    await pg.actAs(ALICE);
    const c = await loadCentre(as(ALICE));
    expect(c.ok && c.centre.items.find((i) => i.type === 'expiry')).toMatchObject({ title: 'Chicken: use by tomorrow', link: `/pantry?item=${ITEM}` });
  });

  it('the job prunes a dead token reported by the push service', async () => {
    await pg.admin(`insert into public.pantry_items (household_id, display_name, quantity_kind, quantity_value, unit, expires_on)
      values ('${HA}', 'Yoghurt', 'exact', 1, 'item', current_date);`);
    await pg.actAs(null);
    const today = new Date().toISOString().slice(0, 10);
    const dead = fakeSender('expo', () => 'invalid_token');
    const r = await runNotifyJob({ db: supabaseNotifyJobDb(pg.client), senders: { expo: dead.sender }, now: () => new Date(`${today}T11:30:00Z`) });
    expect(r.devicesDisabled).toBe(1);
    const d = await pg.db.query<{ disabled_reason: string }>(`select disabled_reason from public.notification_devices`);
    expect(d.rows).toEqual([{ disabled_reason: 'invalid_token' }]);
  });
});
