// Push senders behind one interface (P1-C, D382). Expo Push API for Android (Expo forwards to FCM with the credentials the
// owner uploads to EAS), Web Push (VAPID) for browsers. Network and crypto are injected so tests never touch the network.
import type { PushChannel } from './types';

export interface PushTarget {
  deviceId: string;
  channel: PushChannel;
  token: string;
  keys?: { p256dh: string; auth: string } | null;
}

/** What may be shown on a lock screen: generic text + an in-app path. */
export interface PushMessage {
  title: string;
  body: string;
  link: string;
  /** Collapses repeats on the device (same tag replaces the previous one). */
  tag?: string;
}

export type PushOutcome = 'sent' | 'invalid_token' | 'retry' | 'error';

export interface PushResult {
  deviceId: string;
  outcome: PushOutcome;
  /** Expo ticket id (receipts are checked later), Web Push status. */
  providerRef?: string;
  errorCode?: string;
}

export interface PushSender {
  readonly channel: PushChannel;
  send(items: readonly { target: PushTarget; message: PushMessage }[]): Promise<PushResult[]>;
}

/** Receipt outcomes for earlier Expo tickets: tickets whose device is gone. */
export interface ReceiptChecker {
  check(ticketIds: readonly string[]): Promise<{ ticketId: string; invalidToken: boolean; ok: boolean }[]>;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const EXPO_SEND = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS = 'https://exp.host/--/api/v2/push/getReceipts';
const EXPO_BATCH = 100;

export const isExpoToken = (t: string): boolean => /^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]{10,200}\]$/.test(t);

function expoHeaders(accessToken: string | undefined): Record<string, string> {
  return {
    accept: 'application/json',
    'accept-encoding': 'gzip, deflate',
    'content-type': 'application/json',
    ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
  };
}

/**
 * Expo Push API. `EXPO_ACCESS_TOKEN` is only needed when "Enhanced push security" is switched on for the Expo project.
 * Tickets: `ok` -> sent (ticket id kept for the receipt check); `DeviceNotRegistered` -> invalid token (pruned);
 * `MessageRateExceeded` / HTTP 429 / 5xx -> retry; anything else -> error.
 */
export function expoSender(opts: { fetchImpl?: FetchLike; accessToken?: string } = {}): PushSender {
  const doFetch: FetchLike = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  return {
    channel: 'expo',
    async send(items) {
      const results: PushResult[] = [];
      for (let i = 0; i < items.length; i += EXPO_BATCH) {
        const batch = items.slice(i, i + EXPO_BATCH);
        const valid = batch.filter((b) => isExpoToken(b.target.token));
        for (const b of batch) if (!isExpoToken(b.target.token)) results.push({ deviceId: b.target.deviceId, outcome: 'invalid_token', errorCode: 'BadToken' });
        if (!valid.length) continue;
        const payload = valid.map((b) => ({
          to: b.target.token,
          title: b.message.title,
          body: b.message.body,
          data: { link: b.message.link },
          sound: 'default',
          channelId: 'default',
          priority: 'high',
          ...(b.message.tag ? { collapseId: b.message.tag } : {}),
        }));
        let res: Awaited<ReturnType<FetchLike>>;
        try {
          res = await doFetch(EXPO_SEND, { method: 'POST', headers: expoHeaders(opts.accessToken), body: JSON.stringify(payload) });
        } catch {
          for (const b of valid) results.push({ deviceId: b.target.deviceId, outcome: 'retry', errorCode: 'network' });
          continue;
        }
        if (!res.ok) {
          const outcome: PushOutcome = res.status === 429 || res.status >= 500 ? 'retry' : 'error';
          for (const b of valid) results.push({ deviceId: b.target.deviceId, outcome, errorCode: `http_${res.status}` });
          continue;
        }
        let body: unknown;
        try {
          body = await res.json();
        } catch {
          body = null;
        }
        const tickets = isObj(body) && Array.isArray(body.data) ? body.data : [];
        valid.forEach((b, idx) => {
          const t = tickets[idx];
          if (isObj(t) && t.status === 'ok' && typeof t.id === 'string') {
            results.push({ deviceId: b.target.deviceId, outcome: 'sent', providerRef: t.id.slice(0, 200) });
            return;
          }
          const code = isObj(t) && isObj(t.details) && typeof t.details.error === 'string' ? t.details.error : 'unknown';
          const outcome: PushOutcome = code === 'DeviceNotRegistered' ? 'invalid_token' : code === 'MessageRateExceeded' ? 'retry' : 'error';
          results.push({ deviceId: b.target.deviceId, outcome, errorCode: code.slice(0, 60) });
        });
      }
      return results;
    },
  };
}

export function expoReceiptChecker(opts: { fetchImpl?: FetchLike; accessToken?: string } = {}): ReceiptChecker {
  const doFetch: FetchLike = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  return {
    async check(ids) {
      const out: { ticketId: string; invalidToken: boolean; ok: boolean }[] = [];
      for (let i = 0; i < ids.length; i += 300) {
        const chunk = ids.slice(i, i + 300);
        const res = await doFetch(EXPO_RECEIPTS, { method: 'POST', headers: expoHeaders(opts.accessToken), body: JSON.stringify({ ids: chunk }) });
        if (!res.ok) throw new Error(`expo receipts http_${res.status}`);
        const body: unknown = await res.json();
        const data = isObj(body) && isObj(body.data) ? body.data : {};
        for (const id of chunk) {
          const r = data[id];
          // A receipt that is not ready yet is simply absent: check again next run (not recorded here).
          if (!isObj(r)) continue;
          const code = isObj(r.details) && typeof r.details.error === 'string' ? r.details.error : '';
          out.push({ ticketId: id, ok: r.status === 'ok', invalidToken: code === 'DeviceNotRegistered' });
        }
      }
      return out;
    },
  };
}

/** The slice of the `web-push` library this sender needs (injected; the real one is loaded lazily on the server). */
export interface WebPushLib {
  sendNotification(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    options: { vapidDetails: { subject: string; publicKey: string; privateKey: string }; TTL: number; urgency?: 'normal' | 'high'; topic?: string },
  ): Promise<{ statusCode: number }>;
}

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/**
 * Web Push with VAPID. Payload is JSON `{ title, body, link, tag }`; the service worker (`public/sw.js`) shows it and opens
 * `link` on click. 404 / 410 from the push service -> invalid token (subscription gone, pruned); 429 / 5xx -> retry.
 */
export function webPushSender(vapid: VapidConfig, lib: WebPushLib | (() => Promise<WebPushLib>)): PushSender {
  let loaded: WebPushLib | null = typeof lib === 'function' ? null : lib;
  const get = async () => (loaded ??= await (lib as () => Promise<WebPushLib>)());
  return {
    channel: 'webpush',
    async send(items) {
      const results: PushResult[] = [];
      for (const { target, message } of items) {
        if (!target.keys?.p256dh || !target.keys.auth || !/^https:\/\//.test(target.token)) {
          results.push({ deviceId: target.deviceId, outcome: 'invalid_token', errorCode: 'BadSubscription' });
          continue;
        }
        const payload = JSON.stringify({ title: message.title, body: message.body, link: message.link, tag: message.tag ?? null });
        try {
          const web = await get();
          const r = await web.sendNotification({ endpoint: target.token, keys: { p256dh: target.keys.p256dh, auth: target.keys.auth } }, payload, {
            vapidDetails: vapid,
            TTL: 24 * 3600,
            urgency: 'normal',
            ...(message.tag ? { topic: message.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) } : {}),
          });
          results.push({ deviceId: target.deviceId, outcome: 'sent', providerRef: String(r.statusCode) });
        } catch (e) {
          const status = isObj(e) && typeof e.statusCode === 'number' ? e.statusCode : 0;
          const outcome: PushOutcome = status === 404 || status === 410 ? 'invalid_token' : status === 429 || status >= 500 || status === 0 ? 'retry' : 'error';
          results.push({ deviceId: target.deviceId, outcome, errorCode: status ? `http_${status}` : 'network' });
        }
      }
      return results;
    },
  };
}

/** A sender that records what it would send (tests, and channels that are not configured: they never "succeed"). */
export function fakeSender(channel: PushChannel, outcomeFor: (t: PushTarget) => PushOutcome = () => 'sent') {
  const sent: { target: PushTarget; message: PushMessage }[] = [];
  const sender: PushSender = {
    channel,
    async send(items) {
      sent.push(...items);
      return items.map(({ target }, i) => {
        const outcome = outcomeFor(target);
        return { deviceId: target.deviceId, outcome, ...(outcome === 'sent' ? { providerRef: `${channel}-${sent.length - items.length + i + 1}` } : {}) };
      });
    },
  };
  return { sender, sent };
}
