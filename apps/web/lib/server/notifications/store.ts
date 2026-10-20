// User-facing notification storage: Supabase as the signed-in user (RLS decides) or a process-wide in-memory demo store.
// Never the service role (D100): the job has its own port (job.ts / supabase-job-db.ts).
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DeviceRow } from './job';
import { activityLink, activityText, isActivityType, recipientFromRow, type ActivityRow } from './schedule';
import {
  CONFIGURABLE_TYPES,
  defaultSettings,
  type ActivityEventView,
  type CentreView,
  type DeviceRegistration,
  type NotificationSettings,
  type NotificationType,
  type NotificationView,
} from './types';

export type NotificationErrorCode = 'rate_limited' | 'forbidden' | 'not_found' | 'unknown';
export class NotificationError extends Error {
  constructor(readonly code: NotificationErrorCode) {
    super(code);
    this.name = 'NotificationError';
  }
}

export interface DeviceCounts {
  web: number;
  android: number;
}

export interface NotificationStore {
  centre(householdId: string, userId: string, limit: number): Promise<CentreView>;
  unread(householdId: string, userId: string): Promise<number>;
  /** ids = null: everything. */
  markRead(householdId: string, userId: string, ids: readonly string[] | null): Promise<void>;
  getSettings(householdId: string, userId: string): Promise<NotificationSettings>;
  saveSettings(householdId: string, userId: string, s: NotificationSettings): Promise<void>;
  registerDevice(householdId: string, userId: string, reg: DeviceRegistration): Promise<void>;
  unregisterDevice(userId: string, token: string): Promise<void>;
  deviceCounts(householdId: string, userId: string): Promise<DeviceCounts>;
  /** Creates the test notification; `pushPending` when the caller has a device to send to. */
  createTest(householdId: string, userId: string): Promise<{ id: string; pushPending: boolean }>;
  ownDevices(householdId: string, userId: string): Promise<DeviceRow[]>;
  completeTest(id: string, sent: boolean, invalidDeviceIds: readonly string[]): Promise<void>;
  activity(householdId: string, userId: string, limit: number): Promise<ActivityEventView[]>;
}

export const FEED_DAYS = 14;

export function activityView(r: ActivityRow, userId: string): ActivityEventView | null {
  if (!isActivityType(r.type)) return null;
  return {
    id: r.id,
    type: r.type,
    actor: r.actor_id === userId ? 'You' : (r.actor_name?.trim() || 'A member').slice(0, 60),
    text: activityText(r.type, r.subject),
    link: activityLink(r.type, r.ref_id),
    at: new Date(r.at).toISOString(),
    mine: r.actor_id === userId,
  };
}

/* ------------------------------------------------------------------ in memory (mock / demo mode) */

interface MemNotification extends NotificationView {
  householdId: string;
  userId: string;
}
interface MemState {
  notifications: MemNotification[];
  settings: Map<string, NotificationSettings>;
  devices: (DeviceRow & { platform: string })[];
}
const MEM_KEY = Symbol.for('fr.notifications.memory');
type G = typeof globalThis & { [MEM_KEY]?: MemState };
export function memoryState(): MemState {
  const g = globalThis as G;
  return (g[MEM_KEY] ??= { notifications: [], settings: new Map(), devices: [] });
}
/** Tests / the e2e reset endpoint. */
export function resetMemoryNotifications(): void {
  (globalThis as G)[MEM_KEY] = { notifications: [], settings: new Map(), devices: [] };
}

/** Demo household activity (mock mode has no command log): who did what, relative to now. */
function demoActivity(householdId: string, now: number): ActivityRow[] {
  const ago = (min: number) => new Date(now - min * 60_000).toISOString();
  const row = (id: string, type: string, actor: string, subject: string | null, min: number): ActivityRow => ({
    id: `demo:${id}`, household_id: householdId, type, actor_id: `demo-${actor}`, actor_name: actor, subject, list_id: null, ref_id: null, at: ago(min),
  });
  return [
    row('1', 'purchase_by_other', 'Bob Smith', 'potatoes', 40),
    row('2', 'item_added', 'Bob Smith', 'bin bags', 95),
    row('3', 'plan_approved', 'Alice Smith', null, 60 * 20),
    row('4', 'recipe_added', 'Carol Smith', 'Chicken traybake', 60 * 30),
  ];
}

export class MemoryNotificationStore implements NotificationStore {
  private get s() {
    return memoryState();
  }
  private mine(hh: string, user: string) {
    return this.s.notifications.filter((n) => n.householdId === hh && n.userId === user);
  }
  async centre(hh: string, user: string, limit: number): Promise<CentreView> {
    const all = this.mine(hh, user).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { items: all.slice(0, limit).map(({ householdId: _h, userId: _u, ...v }) => v), unread: all.filter((n) => !n.read).length };
  }
  async unread(hh: string, user: string) {
    return this.mine(hh, user).filter((n) => !n.read).length;
  }
  async markRead(hh: string, user: string, ids: readonly string[] | null) {
    for (const n of this.mine(hh, user)) if (!ids || ids.includes(n.id)) n.read = true;
  }
  async getSettings(hh: string, user: string) {
    return structuredClone(this.s.settings.get(`${hh}|${user}`) ?? defaultSettings());
  }
  async saveSettings(hh: string, user: string, settings: NotificationSettings) {
    this.s.settings.set(`${hh}|${user}`, structuredClone(settings));
  }
  async registerDevice(hh: string, user: string, reg: DeviceRegistration) {
    const s = this.s;
    s.devices = s.devices.filter((d) => !(d.token === reg.token && (d.userId !== user || d.householdId === hh)));
    s.devices.push({ deviceId: randomUUID(), userId: user, householdId: hh, channel: reg.channel, token: reg.token, keys: reg.keys ?? null, platform: reg.platform });
  }
  async unregisterDevice(user: string, token: string) {
    this.s.devices = this.s.devices.filter((d) => !(d.userId === user && d.token === token));
  }
  async deviceCounts(hh: string, user: string): Promise<DeviceCounts> {
    const mine = this.s.devices.filter((d) => d.householdId === hh && d.userId === user);
    return { web: mine.filter((d) => d.platform === 'web').length, android: mine.filter((d) => d.platform === 'android').length };
  }
  async createTest(hh: string, user: string) {
    const recent = this.mine(hh, user).find((n) => n.type === 'test' && Date.now() - Date.parse(n.createdAt) < 30_000);
    if (recent) throw new NotificationError('rate_limited');
    const id = randomUUID();
    this.s.notifications.push({
      id, householdId: hh, userId: user, type: 'test', title: 'Test notification',
      body: 'Notifications are working. You can change what you get in Settings > Notifications.', link: '/notifications',
      createdAt: new Date().toISOString(), read: false,
    });
    return { id, pushPending: (await this.ownDevices(hh, user)).length > 0 };
  }
  async ownDevices(hh: string, user: string) {
    return this.s.devices.filter((d) => d.householdId === hh && d.userId === user);
  }
  async completeTest(_id: string, _sent: boolean, invalid: readonly string[]) {
    this.s.devices = this.s.devices.filter((d) => !invalid.includes(d.deviceId));
  }
  async activity(hh: string, user: string, limit: number) {
    return demoActivity(hh, Date.now()).map((r) => activityView(r, user)).filter((v): v is ActivityEventView => !!v).slice(0, limit);
  }
  /** Mock / test helper: add a notification as the job would. */
  push(n: { householdId: string; userId: string; type: NotificationType; title: string; body?: string; link?: string }) {
    this.s.notifications.push({ id: randomUUID(), body: '', link: '/notifications', createdAt: new Date().toISOString(), read: false, ...n });
  }
}

/* ------------------------------------------------------------------ Supabase (as the signed-in user) */

const pgErr = (e: { code?: string } | null): never => {
  if (e?.code === '42501') throw new NotificationError('forbidden');
  if (e?.code === 'P0001') throw new NotificationError('rate_limited');
  if (e?.code === 'P0002') throw new NotificationError('not_found');
  throw new NotificationError('unknown');
};

export class SupabaseNotificationStore implements NotificationStore {
  constructor(private readonly client: SupabaseClient) {}

  async centre(hh: string, user: string, limit: number): Promise<CentreView> {
    const { data, error } = await this.client
      .from('notifications')
      .select('id, type, title, body, link, created_at, read_at')
      .eq('household_id', hh)
      .eq('user_id', user)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) pgErr(error);
    const items = ((data ?? []) as Record<string, unknown>[]).map((r): NotificationView => ({
      id: String(r.id), type: r.type as NotificationType, title: String(r.title), body: String(r.body ?? ''), link: String(r.link),
      createdAt: new Date(String(r.created_at)).toISOString(), read: r.read_at != null,
    }));
    return { items, unread: await this.unread(hh, user) };
  }
  async unread(hh: string, user: string) {
    const { count, error } = await this.client
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('household_id', hh)
      .eq('user_id', user)
      .is('read_at', null);
    if (error) pgErr(error);
    return count ?? 0;
  }
  async markRead(hh: string, user: string, ids: readonly string[] | null) {
    let q = this.client.from('notifications').update({ read_at: new Date().toISOString() }).eq('household_id', hh).eq('user_id', user).is('read_at', null);
    if (ids) q = q.in('id', [...ids]);
    const { error } = await q;
    if (error) pgErr(error);
  }
  async getSettings(hh: string, user: string): Promise<NotificationSettings> {
    const [s, p] = await Promise.all([
      this.client.from('notification_settings').select('*').eq('household_id', hh).eq('user_id', user).maybeSingle(),
      this.client.from('notification_preferences').select('type, in_app, push').eq('household_id', hh).eq('user_id', user),
    ]);
    if (s.error) pgErr(s.error);
    if (p.error) pgErr(p.error);
    const row = (s.data ?? {}) as Record<string, unknown>;
    const prefs: Record<string, { inApp: boolean; push: boolean }> = {};
    for (const r of (p.data ?? []) as { type: string; in_app: boolean; push: boolean }[]) prefs[r.type] = { inApp: r.in_app, push: r.push };
    return recipientFromRow({
      household_id: hh, user_id: user,
      quiet_enabled: (row.quiet_enabled as boolean | undefined) ?? null, quiet_start: (row.quiet_start as string | undefined) ?? null,
      quiet_end: (row.quiet_end as string | undefined) ?? null, time_zone: (row.time_zone as string | undefined) ?? null,
      morning_hour: (row.morning_hour as number | undefined) ?? null, expiry_lead_days: (row.expiry_lead_days as number | undefined) ?? null,
      prefs,
    }).settings;
  }
  async saveSettings(hh: string, user: string, s: NotificationSettings) {
    const a = await this.client.from('notification_settings').upsert({
      household_id: hh, user_id: user, quiet_enabled: s.quietEnabled, quiet_start: s.quietStart, quiet_end: s.quietEnd,
      time_zone: s.timeZone, morning_hour: s.morningHour, expiry_lead_days: s.expiryLeadDays, updated_at: new Date().toISOString(),
    }, { onConflict: 'household_id,user_id' });
    if (a.error) pgErr(a.error);
    const b = await this.client.from('notification_preferences').upsert(
      CONFIGURABLE_TYPES.map((t) => ({ household_id: hh, user_id: user, type: t, in_app: s.types[t].inApp, push: s.types[t].push, updated_at: new Date().toISOString() })),
      { onConflict: 'household_id,user_id,type' },
    );
    if (b.error) pgErr(b.error);
  }
  async registerDevice(hh: string, _user: string, reg: DeviceRegistration) {
    const { error } = await this.client.rpc('register_push_device', {
      p_household_id: hh, p_platform: reg.platform, p_channel: reg.channel, p_token: reg.token, p_keys: reg.keys ?? null, p_label: reg.label ?? null,
    });
    if (error) pgErr(error);
  }
  async unregisterDevice(_user: string, token: string) {
    const { error } = await this.client.rpc('unregister_push_device', { p_token: token });
    if (error) pgErr(error);
  }
  async deviceCounts(hh: string, user: string): Promise<DeviceCounts> {
    const { data, error } = await this.client.from('notification_devices').select('platform').eq('household_id', hh).eq('user_id', user).is('disabled_at', null);
    if (error) pgErr(error);
    const rows = (data ?? []) as { platform: string }[];
    return { web: rows.filter((r) => r.platform === 'web').length, android: rows.filter((r) => r.platform === 'android').length };
  }
  async createTest(hh: string, user: string) {
    const { data, error } = await this.client.rpc('request_test_notification', { p_household_id: hh });
    if (error) pgErr(error);
    const id = String(data);
    const { data: row, error: e2 } = await this.client.from('notifications').select('push_status').eq('id', id).eq('user_id', user).maybeSingle();
    if (e2) pgErr(e2);
    return { id, pushPending: (row as { push_status?: string } | null)?.push_status === 'pending' };
  }
  async ownDevices(hh: string, user: string): Promise<DeviceRow[]> {
    const { data, error } = await this.client
      .from('notification_devices')
      .select('id, user_id, household_id, channel, token, keys')
      .eq('household_id', hh)
      .eq('user_id', user)
      .is('disabled_at', null);
    if (error) pgErr(error);
    return ((data ?? []) as Record<string, unknown>[]).map((r) => {
      const k = r.keys as { p256dh?: string; auth?: string } | null;
      return {
        deviceId: String(r.id), userId: String(r.user_id), householdId: String(r.household_id), channel: r.channel as DeviceRow['channel'],
        token: String(r.token), keys: k?.p256dh && k.auth ? { p256dh: k.p256dh, auth: k.auth } : null,
      };
    });
  }
  async completeTest(id: string, sent: boolean, invalid: readonly string[]) {
    const { error } = await this.client.rpc('complete_test_push', { p_notification_id: id, p_sent: sent, p_invalid_device_ids: [...invalid] });
    if (error) pgErr(error);
  }
  async activity(hh: string, user: string, limit: number) {
    const now = Date.now();
    const { data, error } = await this.client.rpc('activity_events', {
      p_household_id: hh, p_since: new Date(now - FEED_DAYS * 86_400_000).toISOString(), p_until: new Date(now + 60_000).toISOString(), p_limit: limit,
    });
    if (error) pgErr(error);
    return ((data ?? []) as ActivityRow[]).map((r) => activityView(r, user)).filter((v): v is ActivityEventView => !!v);
  }
}
