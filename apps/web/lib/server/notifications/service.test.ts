import { beforeEach, describe, expect, it } from 'vitest';
import { fakeSender } from './senders';
import { loadActivity, loadCentre, loadSettings, markRead, parseDevice, parseSettings, registerDevice, saveSettings, sendTest, unregisterDevice, type NotificationCaller } from './service';
import { MemoryNotificationStore, resetMemoryNotifications } from './store';
import { defaultSettings } from './types';

const caller: NotificationCaller = { householdId: 'hh-a', userId: 'alice', client: null, readOnly: false };
const other: NotificationCaller = { ...caller, userId: 'bob' };
const phone = { platform: 'android', channel: 'expo', token: 'ExponentPushToken[abcdefghijkl]' };

beforeEach(() => resetMemoryNotifications());

describe('notification service (memory store)', () => {
  it('test notification lands in the centre, is rate limited, and marks read', async () => {
    const r = await sendTest(caller, {});
    expect(r).toEqual({ ok: true, outcome: 'no_devices' });
    expect(await sendTest(caller, {})).toEqual({ ok: false, error: 'rate_limited' });
    const c = await loadCentre(caller);
    expect(c.ok && c.centre.unread).toBe(1);
    expect(c.ok && c.centre.items[0]).toMatchObject({ type: 'test', title: 'Test notification', link: '/notifications', read: false });
    expect(await loadCentre(other)).toMatchObject({ ok: true, centre: { unread: 0, items: [] } });
    expect(await markRead(caller)).toEqual({ ok: true, unread: 0 });
  });

  it('test push goes to the caller’s own devices only; dead tokens are removed', async () => {
    await registerDevice(caller, phone);
    await registerDevice(other, { ...phone, token: 'ExponentPushToken[bobbobbobbob]' });
    const expo = fakeSender('expo');
    expect(await sendTest(caller, { expo: expo.sender })).toEqual({ ok: true, outcome: 'sent' });
    expect(expo.sent.map((s) => s.target.token)).toEqual(['ExponentPushToken[abcdefghijkl]']);
    expect(expo.sent[0]!.message.body).toBe('Test notification: notifications are working.');
    resetMemoryNotifications();
    await registerDevice(caller, phone);
    const dead = fakeSender('expo', () => 'invalid_token');
    expect(await sendTest(caller, { expo: dead.sender })).toEqual({ ok: true, outcome: 'no_devices' });
    expect(await loadSettings(caller)).toMatchObject({ ok: true, devices: { android: 0 } });
  });

  it('device validation and unregister', async () => {
    expect(parseDevice({ platform: 'android', channel: 'expo', token: 'nope-nope-nope' })).toBeNull();
    expect(parseDevice({ platform: 'web', channel: 'webpush', token: 'http://insecure.example/x', keys: { p256dh: 'aaaaaaaa', auth: 'bbbbbbbb' } })).toBeNull();
    expect(parseDevice({ platform: 'web', channel: 'expo', token: 'ExponentPushToken[abcdefghijkl]' })).toBeNull();
    expect(parseDevice({ platform: 'web', channel: 'webpush', token: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'BPk-_aaaa', auth: 'bbbbbbbb' } })).not.toBeNull();
    expect(await registerDevice(caller, { platform: 'android' })).toEqual({ ok: false, error: 'invalid_input' });
    await registerDevice(caller, phone);
    expect(await unregisterDevice(caller, phone.token)).toEqual({ ok: true, devices: { web: 0, android: 0 } });
  });

  it('settings: defaults, validation, round trip, read-only refused', async () => {
    expect(await loadSettings(caller)).toMatchObject({ ok: true, settings: defaultSettings() });
    expect(parseSettings({ ...defaultSettings(), quietStart: '25:00', timeZone: 'Mars/Base', morningHour: 3 })).toMatchObject({
      ok: false, fieldErrors: { quietStart: expect.any(String), timeZone: expect.any(String), morningHour: expect.any(String) },
    });
    const next = { ...defaultSettings(), quietStart: '22:00', types: { ...defaultSettings().types, recipe_added: { inApp: false, push: true } } };
    const saved = await saveSettings(caller, next);
    expect(saved.ok && saved.settings.quietStart).toBe('22:00');
    expect(saved.ok && saved.settings.types.recipe_added).toEqual({ inApp: false, push: false });
    expect(await saveSettings({ ...caller, readOnly: true }, next)).toEqual({ ok: false, error: 'read_only' });
  });

  it('activity feed (demo data in mock mode) marks nothing as mine for another user', async () => {
    const r = await loadActivity(caller, 3);
    expect(r.ok && r.events).toHaveLength(3);
    expect(r.ok && r.events[0]).toMatchObject({ type: 'purchase_by_other', actor: 'Bob Smith', text: 'ticked off potatoes', link: '/shopping', mine: false });
  });

  it('markRead validates ids', async () => {
    new MemoryNotificationStore().push({ householdId: 'hh-a', userId: 'alice', type: 'expiry', title: 'Chicken: use by today' });
    expect(await markRead(caller, 'all')).toEqual({ ok: false, error: 'invalid_input' });
    expect(await markRead(caller, [])).toEqual({ ok: true, unread: 1 });
  });
});
