import { describe, expect, it } from 'vitest';
import { ACTIVITY_CURSOR, buildMessages, deliver, runNotifyJob, type AttemptRow, type DeviceRow, type NotifyJobDb, type PendingPush, type PushUpdate } from './job';
import { recipientFromRow, type ActivityRow, type ExpiryCandidate, type NewNotification } from './schedule';
import { expoReceiptChecker, expoSender, fakeSender, webPushSender, type WebPushLib } from './senders';

const HH = 'aa000000-0000-4000-8000-0000000000aa';
const ALICE = 'a0000000-0000-4000-8000-000000000001';
const BOB = 'b0000000-0000-4000-8000-000000000002';
const NOW = new Date('2026-10-20T08:15:00Z');

const pending = (over: Partial<PendingPush> = {}): PendingPush => ({
  id: 'n1', householdId: HH, userId: ALICE, type: 'expiry', pushTitle: 'Food to use soon', pushBody: 'Something...', link: '/pantry?item=x',
  attempts: 0, createdAt: NOW.toISOString(), ...over,
});
const expoDev: DeviceRow = { deviceId: 'd-phone', userId: ALICE, householdId: HH, channel: 'expo', token: 'ExponentPushToken[abcdefghijkl]' };
const webDev: DeviceRow = { deviceId: 'd-web', userId: ALICE, householdId: HH, channel: 'webpush', token: 'https://push.example.test/s/1', keys: { p256dh: 'BPkkkkkk', auth: 'aaaaaaaa' } };

/** In-memory NotifyJobDb with the database's dedupe rule. */
function fakeDb(opts: { candidates?: ExpiryCandidate[]; events?: ActivityRow[]; devices?: DeviceRow[]; cursor?: string | null } = {}) {
  const notes: (NewNotification & { id: string; status: string; attempts: number })[] = [];
  const attempts: AttemptRow[] = [];
  const disabled: string[] = [];
  const cursors = new Map<string, string>(opts.cursor ? [[ACTIVITY_CURSOR, opts.cursor]] : []);
  const db: NotifyJobDb = {
    recipients: async () => [ALICE, BOB].map((u) => recipientFromRow({
      household_id: HH, user_id: u, quiet_enabled: null, quiet_start: null, quiet_end: null, time_zone: null, morning_hour: null, expiry_lead_days: null, prefs: {},
    })),
    expiryCandidates: async () => opts.candidates ?? [],
    getCursor: async (k) => cursors.get(k) ?? null,
    setCursor: async (k, v) => void cursors.set(k, v),
    activity: async () => opts.events ?? [],
    recentShoppers: async () => [],
    insertNotifications: async (rows) => {
      let n = 0;
      for (const r of rows) {
        if (notes.some((x) => x.userId === r.userId && x.householdId === r.householdId && x.dedupeKey === r.dedupeKey)) continue;
        notes.push({ ...r, id: `n${notes.length + 1}`, status: r.pushStatus, attempts: 0 });
        n++;
      }
      return n;
    },
    pendingPushes: async (now) => notes.filter((x) => x.status === 'pending' && x.deliverAfter <= now).map((x) => pending({
      id: x.id, userId: x.userId, type: x.type, pushTitle: x.pushTitle, pushBody: x.pushBody, link: x.link, attempts: x.attempts, createdAt: NOW.toISOString(),
    })),
    devicesFor: async (ids) => (opts.devices ?? []).filter((d) => ids.includes(d.userId) && !disabled.includes(d.deviceId)),
    recordAttempts: async (rows) => void attempts.push(...rows),
    updatePushes: async (rows: readonly PushUpdate[]) => {
      for (const u of rows) {
        const x = notes.find((n) => n.id === u.id)!;
        x.status = u.status;
        x.attempts = u.attempts;
        if (u.deliverAfter) x.deliverAfter = u.deliverAfter;
      }
    },
    disableDevices: async (ids) => void disabled.push(...ids),
    receiptsToCheck: async () => [],
    markReceiptsChecked: async () => undefined,
    prune: async () => ({ notifications: 0, devices: 0 }),
  };
  return { db, notes, attempts, disabled, cursors };
}

const chicken: ExpiryCandidate = { householdId: HH, itemId: 'i1', name: 'Chicken', expiresOn: '2026-10-21', category: 'meat_poultry', source: 'manual' };

describe('runNotifyJob', () => {
  it('creates expiry alerts for every member, pushes to registered devices, and is idempotent', async () => {
    const f = fakeDb({ candidates: [chicken], devices: [expoDev] });
    const expo = fakeSender('expo');
    const r1 = await runNotifyJob({ db: f.db, senders: { expo: expo.sender }, now: () => NOW });
    expect(r1).toMatchObject({ ok: true, created: { expiry: 2 }, push: { sent: 1, noDevices: 1 } });
    expect(expo.sent).toHaveLength(1);
    expect(expo.sent[0]!.message).toEqual({ title: 'Food to use soon', body: 'Something in your pantry has a use-by date tomorrow.', link: '/pantry?item=i1', tag: 'expiry' });
    const r2 = await runNotifyJob({ db: f.db, senders: { expo: expo.sender }, now: () => new Date(NOW.getTime() + 3_600_000) });
    expect(r2.created.expiry).toBe(0);
    expect(expo.sent).toHaveLength(1);
  });

  it('first run only sets the activity cursor; later runs derive alerts from new events', async () => {
    const ev: ActivityRow = { id: 'member:1', household_id: HH, type: 'member_joined', actor_id: BOB, actor_name: 'Bob', subject: null, list_id: null, ref_id: null, at: NOW.toISOString() };
    const first = fakeDb({ events: [ev] });
    await runNotifyJob({ db: first.db, senders: {}, now: () => NOW });
    expect(first.cursors.get(ACTIVITY_CURSOR)).toBeDefined();
    expect(first.notes).toHaveLength(0);
    // Alice opted in to member_joined
    const later = fakeDb({ events: [ev], cursor: '2026-10-20T07:00:00.000Z' });
    const base = later.db.recipients;
    later.db.recipients = async () => (await base()).map((r) => (r.userId === ALICE ? { ...r, settings: { ...r.settings, types: { ...r.settings.types, member_joined: { inApp: true, push: false } } } } : r));
    const res = await runNotifyJob({ db: later.db, senders: {}, now: () => NOW });
    expect(res.created.activity).toBe(1);
    expect(later.notes[0]).toMatchObject({ userId: ALICE, title: 'Bob joined the household', pushStatus: 'not_requested' });
  });

  it('prunes dead tokens and retries transient failures with backoff, then gives up', async () => {
    const f = fakeDb({ candidates: [chicken], devices: [expoDev, webDev] });
    const expo = fakeSender('expo', () => 'invalid_token');
    const web = fakeSender('webpush', () => 'retry');
    const r1 = await runNotifyJob({ db: f.db, senders: { expo: expo.sender, webpush: web.sender }, now: () => NOW });
    expect(f.disabled).toEqual(['d-phone']);
    expect(r1.push.retried).toBe(1);
    const alice = f.notes.find((n) => n.userId === ALICE)!;
    expect(alice.status).toBe('pending');
    expect(alice.deliverAfter > NOW.toISOString()).toBe(true);
    let t = NOW.getTime();
    for (let i = 0; i < 3; i++) {
      t += 3_600_000;
      await runNotifyJob({ db: f.db, senders: { expo: expo.sender, webpush: web.sender }, now: () => new Date(t) });
    }
    expect(alice.status).toBe('failed');
    expect(f.attempts.filter((a) => a.deviceId === 'd-web')).toHaveLength(3);
  });

  it('one failing step does not stop the others', async () => {
    const f = fakeDb({ candidates: [chicken], devices: [expoDev] });
    f.db.expiryCandidates = async () => {
      throw new Error('boom');
    };
    const res = await runNotifyJob({ db: f.db, senders: {}, now: () => NOW });
    expect(res.ok).toBe(false);
    expect(res.failedSteps).toEqual(['expiry']);
  });

  it('restock nudges only for opted-in households', async () => {
    const f = fakeDb();
    const asked: string[][] = [];
    const counts = async (hh: readonly string[]) => {
      asked.push([...hh]);
      return new Map(hh.map((h) => [h, 2]));
    };
    await runNotifyJob({ db: f.db, senders: {}, restockCounts: counts, now: () => NOW });
    expect(asked).toEqual([]); // nobody opted in
    const base = f.db.recipients;
    f.db.recipients = async () => (await base()).map((r) => ({ ...r, settings: { ...r.settings, types: { ...r.settings.types, restock: { inApp: true, push: false } } } }));
    const res = await runNotifyJob({ db: f.db, senders: {}, restockCounts: counts, now: () => NOW });
    expect(asked).toEqual([[HH]]);
    expect(res.created.restock).toBe(2);
  });
});

describe('deliver', () => {
  it('collapses several expiry alerts for one person into one push', () => {
    const m = buildMessages([pending({ id: 'a' }), pending({ id: 'b' }), pending({ id: 'c', type: 'test', pushTitle: 'T', pushBody: 'B', link: '/notifications' })]);
    expect(m).toHaveLength(2);
    expect(m[0]).toMatchObject({ ids: ['a', 'b'], message: { body: '2 items in your pantry need using soon.', link: '/pantry' } });
  });
  it('drops pushes older than a day and marks users without devices', async () => {
    const out = await deliver([pending({ id: 'old', createdAt: '2026-10-18T00:00:00Z' }), pending({ id: 'x', userId: BOB })], [], {}, NOW);
    expect(out.updates).toEqual([{ id: 'old', status: 'expired', attempts: 0 }, { id: 'x', status: 'no_devices', attempts: 0 }]);
  });
});

describe('senders (no network)', () => {
  it('Expo: maps tickets, DeviceNotRegistered, rate limits and bad tokens', async () => {
    const calls: unknown[] = [];
    const fetchImpl = async (_u: string, init: { body: string; headers: Record<string, string> }) => {
      calls.push({ body: JSON.parse(init.body), auth: init.headers.authorization });
      return { ok: true, status: 200, json: async () => ({ data: [{ status: 'ok', id: 't-1' }, { status: 'error', details: { error: 'DeviceNotRegistered' } }, { status: 'error', details: { error: 'MessageRateExceeded' } }] }) };
    };
    const s = expoSender({ fetchImpl, accessToken: 'tok' });
    const msg = { title: 'T', body: 'B', link: '/pantry' };
    const res = await s.send([
      { target: { deviceId: '1', channel: 'expo', token: 'ExponentPushToken[aaaaaaaaaaaa]' }, message: msg },
      { target: { deviceId: '2', channel: 'expo', token: 'ExponentPushToken[bbbbbbbbbbbb]' }, message: msg },
      { target: { deviceId: '3', channel: 'expo', token: 'ExponentPushToken[cccccccccccc]' }, message: msg },
      { target: { deviceId: '4', channel: 'expo', token: 'not-a-token' }, message: msg },
    ]);
    expect(res.map((r) => [r.deviceId, r.outcome])).toEqual([['4', 'invalid_token'], ['1', 'sent'], ['2', 'invalid_token'], ['3', 'retry']]);
    expect(calls[0]).toMatchObject({ auth: 'Bearer tok', body: [{ to: 'ExponentPushToken[aaaaaaaaaaaa]', title: 'T', body: 'B', data: { link: '/pantry' }, channelId: 'default' }, {}, {}] });
  });
  it('Expo: HTTP 503 and network errors retry', async () => {
    const msg = { title: 'T', body: 'B', link: '/' };
    const t = { deviceId: '1', channel: 'expo' as const, token: 'ExponentPushToken[aaaaaaaaaaaa]' };
    expect((await expoSender({ fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }) }).send([{ target: t, message: msg }]))[0]!.outcome).toBe('retry');
    expect((await expoSender({ fetchImpl: async () => { throw new Error('offline'); } }).send([{ target: t, message: msg }]))[0]!.outcome).toBe('retry');
  });
  it('Expo receipts flag DeviceNotRegistered', async () => {
    const r = await expoReceiptChecker({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ data: { a: { status: 'ok' }, b: { status: 'error', details: { error: 'DeviceNotRegistered' } } } }) }) }).check(['a', 'b', 'c']);
    expect(r).toEqual([{ ticketId: 'a', ok: true, invalidToken: false }, { ticketId: 'b', ok: false, invalidToken: true }]);
  });
  it('Web Push: 410 prunes, 500 retries, payload is the generic message', async () => {
    const payloads: string[] = [];
    let status = 201;
    const lib: WebPushLib = {
      async sendNotification(_s, payload) {
        payloads.push(payload);
        if (status !== 201) throw Object.assign(new Error('x'), { statusCode: status });
        return { statusCode: 201 };
      },
    };
    const s = webPushSender({ publicKey: 'p', privateKey: 'k', subject: 'mailto:a@example.test' }, lib);
    const msg = { title: 'Food to use soon', body: 'Something...', link: '/pantry', tag: 'expiry' };
    expect((await s.send([{ target: webDev, message: msg }]))[0]!.outcome).toBe('sent');
    expect(JSON.parse(payloads[0]!)).toEqual({ title: 'Food to use soon', body: 'Something...', link: '/pantry', tag: 'expiry' });
    status = 410;
    expect((await s.send([{ target: webDev, message: msg }]))[0]!.outcome).toBe('invalid_token');
    status = 500;
    expect((await s.send([{ target: webDev, message: msg }]))[0]!.outcome).toBe('retry');
    expect((await s.send([{ target: { ...webDev, keys: null }, message: msg }]))[0]!.outcome).toBe('invalid_token');
  });
});
