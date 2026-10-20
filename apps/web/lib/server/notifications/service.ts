// The one notification module for the web pages and the Android app's Bearer routes (P1-C, D380). It takes a verified
// caller (user + household + their own client, or null in mock mode); nothing is taken from the request body but intents.
import type { SupabaseClient } from '@supabase/supabase-js';
import { deliver, type PendingPush } from './job';
import { isHhmm, isValidTimeZone } from './schedule';
import type { PushSender } from './senders';
import { MemoryNotificationStore, NotificationError, SupabaseNotificationStore, type DeviceCounts, type NotificationStore } from './store';
import {
  CONFIGURABLE_TYPES,
  resolveTypes,
  type ActivityEventView,
  type CentreView,
  type DeviceRegistration,
  type NotificationSettings,
  type PushChannel,
  type TypePref,
} from './types';

export interface NotificationCaller {
  householdId: string;
  userId: string;
  client: SupabaseClient | null;
  readOnly: boolean;
}

export type NotifyError = 'invalid_input' | 'forbidden' | 'read_only' | 'rate_limited' | 'not_found' | 'unknown';
export type Result<T> = ({ ok: true } & T) | { ok: false; error: NotifyError; fieldErrors?: Record<string, string> };

export const storeFor = (caller: Pick<NotificationCaller, 'client'>): NotificationStore =>
  caller.client ? new SupabaseNotificationStore(caller.client) : new MemoryNotificationStore();

async function run<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (e) {
    if (e instanceof NotificationError) return { ok: false, error: e.code };
    console.error('[notifications] failed', e instanceof Error ? e.name : 'unknown');
    return { ok: false, error: 'unknown' };
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ------------------------------------------------------------------ centre */

export const loadCentre = (caller: NotificationCaller, limit = 50): Promise<Result<{ centre: CentreView }>> =>
  run(async () => ({ centre: await storeFor(caller).centre(caller.householdId, caller.userId, Math.min(Math.max(limit, 1), 100)) }));

export const loadUnread = (caller: NotificationCaller): Promise<Result<{ unread: number }>> =>
  run(async () => ({ unread: await storeFor(caller).unread(caller.householdId, caller.userId) }));

/** ids omitted = mark everything read. Allowed while the household is read-only (only the reader's own state changes). */
export async function markRead(caller: NotificationCaller, ids?: unknown): Promise<Result<{ unread: number }>> {
  let list: string[] | null = null;
  if (ids !== undefined) {
    if (!Array.isArray(ids) || ids.length > 200 || !ids.every((i) => typeof i === 'string' && (UUID.test(i) || (!caller.client && i.length <= 64)))) {
      return { ok: false, error: 'invalid_input' };
    }
    list = ids as string[];
  }
  return run(async () => {
    const store = storeFor(caller);
    await store.markRead(caller.householdId, caller.userId, list);
    return { unread: await store.unread(caller.householdId, caller.userId) };
  });
}

/* ------------------------------------------------------------------ activity */

export const loadActivity = (caller: NotificationCaller, limit = 20): Promise<Result<{ events: ActivityEventView[] }>> =>
  run(async () => ({ events: await storeFor(caller).activity(caller.householdId, caller.userId, Math.min(Math.max(limit, 1), 100)) }));

/* ------------------------------------------------------------------ settings */

export interface SettingsView {
  settings: NotificationSettings;
  devices: DeviceCounts;
}

export const loadSettings = (caller: NotificationCaller): Promise<Result<SettingsView>> =>
  run(async () => {
    const store = storeFor(caller);
    const [settings, devices] = await Promise.all([store.getSettings(caller.householdId, caller.userId), store.deviceCounts(caller.householdId, caller.userId)]);
    return { settings, devices };
  });

/** Validate a settings payload (web form, Android JSON). Unknown types are ignored; push without in-app is dropped. */
export function parseSettings(raw: unknown): { ok: true; settings: NotificationSettings } | { ok: false; fieldErrors: Record<string, string> } {
  const e: Record<string, string> = {};
  if (!isObj(raw)) return { ok: false, fieldErrors: { form: 'Send the settings as an object.' } };
  const quietEnabled = raw.quietEnabled === true;
  if (!isHhmm(raw.quietStart)) e.quietStart = 'Enter a time like 21:30.';
  if (!isHhmm(raw.quietEnd)) e.quietEnd = 'Enter a time like 07:30.';
  if (!isValidTimeZone(raw.timeZone)) e.timeZone = 'Choose a time zone.';
  const morningHour = Number(raw.morningHour);
  if (!Number.isInteger(morningHour) || morningHour < 5 || morningHour > 12) e.morningHour = 'Choose an hour between 5 and 12.';
  const expiryLeadDays = Number(raw.expiryLeadDays);
  if (!Number.isInteger(expiryLeadDays) || expiryLeadDays < 0 || expiryLeadDays > 3) e.expiryLeadDays = 'Choose 0 to 3 days.';
  const typesIn = isObj(raw.types) ? raw.types : {};
  const stored: Record<string, Partial<TypePref>> = {};
  for (const t of CONFIGURABLE_TYPES) {
    const v = typesIn[t];
    if (isObj(v)) stored[t] = { ...(typeof v.inApp === 'boolean' ? { inApp: v.inApp } : {}), ...(typeof v.push === 'boolean' ? { push: v.push } : {}) };
  }
  if (Object.keys(e).length) return { ok: false, fieldErrors: e };
  return {
    ok: true,
    settings: {
      quietEnabled, quietStart: raw.quietStart as string, quietEnd: raw.quietEnd as string, timeZone: raw.timeZone as string,
      morningHour, expiryLeadDays, types: resolveTypes(stored),
    },
  };
}

export async function saveSettings(caller: NotificationCaller, raw: unknown): Promise<Result<SettingsView>> {
  if (caller.readOnly) return { ok: false, error: 'read_only' };
  const p = parseSettings(raw);
  if (!p.ok) return { ok: false, error: 'invalid_input', fieldErrors: p.fieldErrors };
  const saved = await run(async () => {
    await storeFor(caller).saveSettings(caller.householdId, caller.userId, p.settings);
    return {};
  });
  return saved.ok ? loadSettings(caller) : saved;
}

/* ------------------------------------------------------------------ devices */

export function parseDevice(raw: unknown): DeviceRegistration | null {
  if (!isObj(raw)) return null;
  const { platform, channel, token } = raw;
  if (platform !== 'web' && platform !== 'android') return null;
  if (channel !== 'expo' && channel !== 'webpush') return null;
  if (typeof token !== 'string' || token.length < 10 || token.length > 2000) return null;
  const label = typeof raw.label === 'string' ? raw.label.trim().slice(0, 80) : undefined;
  if (channel === 'expo') {
    if (platform !== 'android' || !/^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]{10,200}\]$/.test(token)) return null;
    return { platform, channel, token, ...(label ? { label } : {}) };
  }
  // Web Push: an https endpoint + the subscription's public keys (base64url).
  if (!/^https:\/\/[^\s]+$/.test(token) || !isObj(raw.keys)) return null;
  const { p256dh, auth } = raw.keys;
  const b64 = /^[A-Za-z0-9_-]{8,200}={0,2}$/;
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || !b64.test(p256dh) || !b64.test(auth)) return null;
  return { platform, channel, token, keys: { p256dh, auth }, ...(label ? { label } : {}) };
}

export async function registerDevice(caller: NotificationCaller, raw: unknown): Promise<Result<{ devices: DeviceCounts }>> {
  const reg = parseDevice(raw);
  if (!reg) return { ok: false, error: 'invalid_input' };
  return run(async () => {
    const store = storeFor(caller);
    await store.registerDevice(caller.householdId, caller.userId, reg);
    return { devices: await store.deviceCounts(caller.householdId, caller.userId) };
  });
}

export async function unregisterDevice(caller: NotificationCaller, token: unknown): Promise<Result<{ devices: DeviceCounts }>> {
  if (typeof token !== 'string' || token.length < 10 || token.length > 2000) return { ok: false, error: 'invalid_input' };
  return run(async () => {
    const store = storeFor(caller);
    await store.unregisterDevice(caller.userId, token);
    return { devices: await store.deviceCounts(caller.householdId, caller.userId) };
  });
}

/* ------------------------------------------------------------------ test notification */

export type TestOutcome = 'sent' | 'no_devices' | 'failed' | 'in_app_only';

/**
 * Creates the test notification (always visible in the centre) and, when the caller has devices, sends the push right away
 * as the caller: their own device rows are readable under RLS, and the outcome is recorded with complete_test_push (no
 * service role on the request path, D100).
 */
export async function sendTest(caller: NotificationCaller, senders: Partial<Record<PushChannel, PushSender>>): Promise<Result<{ outcome: TestOutcome }>> {
  return run(async () => {
    const store = storeFor(caller);
    const { id, pushPending } = await store.createTest(caller.householdId, caller.userId);
    if (!pushPending) return { outcome: 'no_devices' as TestOutcome };
    const devices = (await store.ownDevices(caller.householdId, caller.userId)).filter((d) => senders[d.channel]);
    if (!devices.length) {
      await store.completeTest(id, false, []);
      return { outcome: 'in_app_only' as TestOutcome };
    }
    const pending: PendingPush = {
      id, householdId: caller.householdId, userId: caller.userId, type: 'test', pushTitle: 'Family Recipes',
      pushBody: 'Test notification: notifications are working.', link: '/notifications', attempts: 0, createdAt: new Date().toISOString(),
    };
    const { updates, invalidDevices } = await deliver([pending], devices, senders, new Date());
    const sent = updates.some((u) => u.status === 'sent');
    await store.completeTest(id, sent, invalidDevices);
    return { outcome: (sent ? 'sent' : invalidDevices.length === devices.length ? 'no_devices' : 'failed') as TestOutcome };
  });
}
