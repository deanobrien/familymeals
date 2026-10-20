// Browser-side helpers for the notification JSON API (cookie session). The same routes serve the Android app with a Bearer
// token. Types are re-exported from the pure server contract (no server-only imports there).
import type { ActivityEventView, CentreView, NotificationSettings } from '../server/notifications/types';

export type { ActivityEventView, CentreView, NotificationSettings, NotificationView, ConfigurableType, TypePref } from '../server/notifications/types';
export { CONFIGURABLE_TYPES, TYPE_META } from '../server/notifications/types';

/** Fired after anything changes the unread count, so the bell refreshes at once instead of on its next poll. */
export const CHANGED_EVENT = 'fr:notifications-changed';
export const notifyChanged = () => window.dispatchEvent(new Event(CHANGED_EVENT));

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly fieldErrors?: Record<string, string>) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', ...init, headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}) } });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* empty */
  }
  if (!res.ok) {
    const e = (body as { error?: { message?: string; code?: string; fieldErrors?: Record<string, string> } } | null)?.error;
    throw new ApiError(e?.message ?? 'Something went wrong. Please try again.', res.status, e?.code, e?.fieldErrors);
  }
  return body as T;
}
const post = <T>(path: string, body: unknown) => call<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const api = {
  unread: () => call<{ unread: number }>('/api/notifications?summary=1'),
  centre: () => call<{ centre: CentreView }>('/api/notifications'),
  markRead: (ids?: string[]) => post<{ unread: number }>('/api/notifications', ids ? { action: 'read', ids } : { action: 'read_all' }),
  activity: (limit = 10) => call<{ events: ActivityEventView[] }>(`/api/notifications/activity?limit=${limit}`),
  settings: () => call<{ settings: NotificationSettings; devices: { web: number; android: number } }>('/api/notifications/settings'),
  saveSettings: (settings: NotificationSettings) => post<{ settings: NotificationSettings; devices: { web: number; android: number } }>('/api/notifications/settings', { settings }),
  config: () => call<{ webPushPublicKey: string | null; pushEnabled: boolean }>('/api/notifications/config'),
  register: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, label: string) =>
    post<{ devices: { web: number; android: number } }>('/api/notifications/devices', { action: 'register', platform: 'web', channel: 'webpush', token: sub.endpoint, keys: sub.keys, label }),
  unregister: (token: string) => post<{ devices: { web: number; android: number } }>('/api/notifications/devices', { action: 'unregister', token }),
  test: () => post<{ outcome: 'sent' | 'no_devices' | 'failed' | 'in_app_only' }>('/api/notifications/test', {}),
};

export function relativeTime(iso: string, now = Date.now()): string {
  const mins = Math.round((now - Date.parse(iso)) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/* ---------------------------------------------------------------- Web Push (browser) */

export const pushSupported = (): boolean =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/**
 * Called only from a button click (browsers require a user gesture and it is the polite way, D389): ask permission,
 * register the service worker, subscribe with the VAPID public key and register the subscription with the server.
 */
export async function enableBrowserPush(publicKey: string): Promise<'enabled' | 'denied' | 'unsupported'> {
  if (!pushSupported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error('The browser did not return a usable subscription.');
  await api.register({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } }, browserLabel());
  return 'enabled';
}

export async function disableBrowserPush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await api.unregister(sub.endpoint).catch(() => undefined);
  await sub.unsubscribe().catch(() => undefined);
}

function browserLabel(): string {
  const ua = navigator.userAgent;
  const name = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return `${name}${os ? ` on ${os}` : ''}`;
}
