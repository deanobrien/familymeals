/**
 * Client + defensive parsers for the notification JSON API (apps/web `/api/notifications*`, P1-C D380). The server owns
 * all notification logic (settings validation, defaults, scheduling, delivery); the app renders what it gets back.
 * Types are app-side copies of the contract in apps/web/lib/server/notifications/types.ts (never imported from the web app).
 */
import type { ServerApi } from './serverApi';

export const CONFIGURABLE_TYPES = [
  'expiry',
  'list_changed_while_shopping',
  'purchase_by_other',
  'item_added',
  'plan_approved',
  'recipe_added',
  'member_joined',
  'restock',
] as const;
export type ConfigurableType = (typeof CONFIGURABLE_TYPES)[number];

/** Same labels as the web (TYPE_META); kept identical by __tests__/notifications.test.ts reading the web file. */
export const TYPE_LABELS: Record<ConfigurableType, { label: string; hint: string }> = {
  expiry: { label: 'Food to use soon', hint: 'A morning reminder when pantry items reach their use-by or best-before date.' },
  list_changed_while_shopping: { label: 'List changed while you are shopping', hint: 'Someone adds to the list you are ticking off in the shop.' },
  purchase_by_other: { label: 'Items bought by others', hint: 'Another member ticks something off.' },
  item_added: { label: 'Items added to the list', hint: 'Another member adds to a shopping list.' },
  plan_approved: { label: 'Meal plan approved', hint: 'The week’s plan is approved.' },
  recipe_added: { label: 'New recipes', hint: 'Another member adds a recipe.' },
  member_joined: { label: 'New members', hint: 'Someone joins the household.' },
  restock: { label: 'Below minimum stock', hint: 'A morning nudge when items you keep a minimum of run low (not sent when auto-add to the list is on).' },
};

export interface TypePref { inApp: boolean; push: boolean }
export interface NotificationSettings {
  quietEnabled: boolean;
  quietStart: string;
  quietEnd: string;
  timeZone: string;
  morningHour: number;
  expiryLeadDays: number;
  types: Record<ConfigurableType, TypePref>;
}
export interface DeviceCounts { web: number; android: number }
export interface NotificationItem { id: string; type: string; title: string; body: string; link: string; createdAt: string; read: boolean }
export interface ActivityEvent { id: string; type: string; actor: string; text: string; link: string; at: string; mine: boolean }
export type TestOutcome = 'sent' | 'no_devices' | 'failed' | 'in_app_only';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const bool = (v: unknown, d = false): boolean => (typeof v === 'boolean' ? v : d);

export function parseSettings(v: unknown): NotificationSettings {
  const o = isObj(v) ? v : {};
  const t = isObj(o.types) ? o.types : {};
  const types = {} as Record<ConfigurableType, TypePref>;
  for (const k of CONFIGURABLE_TYPES) {
    const p = isObj(t[k]) ? (t[k] as Obj) : {};
    const inApp = bool(p.inApp);
    types[k] = { inApp, push: inApp && bool(p.push) };
  }
  return {
    quietEnabled: bool(o.quietEnabled, true),
    quietStart: str(o.quietStart, '21:30'),
    quietEnd: str(o.quietEnd, '07:30'),
    timeZone: str(o.timeZone, 'Europe/London'),
    morningHour: num(o.morningHour, 8),
    expiryLeadDays: num(o.expiryLeadDays, 1),
    types,
  };
}
const parseDevices = (v: unknown): DeviceCounts => (isObj(v) ? { web: num(v.web, 0), android: num(v.android, 0) } : { web: 0, android: 0 });

export function parseItems(v: unknown): NotificationItem[] {
  return arr(v).filter(isObj).map((n) => ({
    id: str(n.id), type: str(n.type), title: str(n.title), body: str(n.body), link: str(n.link, '/notifications'), createdAt: str(n.createdAt), read: bool(n.read),
  })).filter((n) => n.id && n.title);
}
export function parseEvents(v: unknown): ActivityEvent[] {
  return arr(v).filter(isObj).map((e) => ({
    id: str(e.id), type: str(e.type), actor: str(e.actor, 'A member'), text: str(e.text), link: str(e.link, '/'), at: str(e.at), mine: bool(e.mine),
  })).filter((e) => e.id && e.text);
}

export async function getUnread(api: ServerApi, householdId: string): Promise<number> {
  const r = await api.get<Obj>('/api/notifications', { householdId, summary: 1 });
  return num(r?.unread, 0);
}
export async function getCentre(api: ServerApi, householdId: string): Promise<{ items: NotificationItem[]; unread: number }> {
  const r = await api.get<Obj>('/api/notifications', { householdId });
  const c = isObj(r?.centre) ? r.centre : {};
  return { items: parseItems(c.items), unread: num(c.unread, 0) };
}
export async function markRead(api: ServerApi, householdId: string, ids?: string[]): Promise<number> {
  const r = await api.post<Obj>('/api/notifications', ids ? { householdId, action: 'read', ids } : { householdId, action: 'read_all' });
  return num(r?.unread, 0);
}
export async function getActivity(api: ServerApi, householdId: string, limit = 20): Promise<ActivityEvent[]> {
  const r = await api.get<Obj>('/api/notifications/activity', { householdId, limit });
  return parseEvents(r?.events);
}
export async function getSettings(api: ServerApi, householdId: string): Promise<{ settings: NotificationSettings; devices: DeviceCounts }> {
  const r = await api.get<Obj>('/api/notifications/settings', { householdId });
  return { settings: parseSettings(r?.settings), devices: parseDevices(r?.devices) };
}
export async function saveSettings(api: ServerApi, householdId: string, settings: NotificationSettings): Promise<{ settings: NotificationSettings; devices: DeviceCounts }> {
  const r = await api.post<Obj>('/api/notifications/settings', { householdId, settings });
  return { settings: parseSettings(r?.settings), devices: parseDevices(r?.devices) };
}
export async function registerPushToken(api: ServerApi, householdId: string, token: string, label: string): Promise<DeviceCounts> {
  const r = await api.post<Obj>('/api/notifications/devices', { householdId, action: 'register', platform: 'android', channel: 'expo', token, label });
  return parseDevices(r?.devices);
}
export async function unregisterPushToken(api: ServerApi, householdId: string, token: string): Promise<DeviceCounts> {
  const r = await api.post<Obj>('/api/notifications/devices', { householdId, action: 'unregister', token });
  return parseDevices(r?.devices);
}
export async function sendTestNotification(api: ServerApi, householdId: string): Promise<TestOutcome> {
  const r = await api.post<Obj>('/api/notifications/test', { householdId });
  const o = str(r?.outcome);
  return (['sent', 'no_devices', 'failed', 'in_app_only'] as const).find((x) => x === o) ?? 'failed';
}

export const TEST_TEXT: Record<TestOutcome, string> = {
  sent: 'Sent. It is in your notifications, and should appear on this phone in a moment.',
  no_devices: 'Added to your notifications. Turn on notifications on this phone to get it as a push.',
  in_app_only: 'Added to your notifications. Push is not set up on the server yet, so nothing was sent to your devices.',
  failed: 'Added to your notifications, but the push could not be delivered. Try again later.',
};

/**
 * Web paths (what the server stores as a notification link) -> app routes. Unknown paths fall back to the notification list,
 * so a tap never lands on a missing screen.
 */
export function linkToRoute(link: string | null | undefined): string {
  const l = typeof link === 'string' ? link : '';
  const path = l.split('?')[0] ?? '';
  const recipe = /^\/recipes\/([A-Za-z0-9-]{1,64})$/.exec(path);
  if (recipe) return `/recipe/${recipe[1]}`;
  switch (path) {
    case '/pantry':
      return '/pantry';
    case '/shopping':
      return '/(tabs)/shopping';
    case '/plan':
      return '/plan';
    case '/recipes':
      return '/(tabs)/recipes';
    case '/household':
      return '/household';
    case '/settings/notifications':
      return '/notification-settings';
    default:
      return '/notifications';
  }
}

export function relativeTime(iso: string, now = Date.now()): string {
  const mins = Math.round((now - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(mins)) return '';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}
