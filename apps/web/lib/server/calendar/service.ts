// Calendar-aware planning service (P2-C, D410-D415). One module, two callers: the web server actions and the bearer JSON
// route /api/calendar (Android). Three sources of "busy evenings": manual toggles (always), the Android device calendar
// (derived on the phone; only flags + minutes arrive here) and an ICS subscription read server-side (SSRF-guarded fetch,
// address stored encrypted, never logged, titles never read).
import 'server-only';
import {
  addCivilDays, busyLabel, deriveBusyDays, isValidTimeZone, mergeBusyDays, parseIcs, parseIsoDate, toIsoDate, zonedToUtc,
  type BusyDay,
} from '@fr/engine/calendar';
import { decryptSecret, encryptSecret, getAppSecret, SettingsError } from '../ai/secret';
import { FetchError, guardedGet } from '../import/url/fetch-page';
import { fixtureFetchOptions } from '../import/url/fixtures';
import { UrlRejectedError, parseImportUrl } from '../import/url/ssrf';
import type { CookingCaller } from '../cooking/service';
import { CALENDAR_ERROR_MESSAGE, type CalendarError, type CalendarResult, type CalendarStatus } from '../../calendar/types';
import { CalendarStoreError, MemoryCalendarStore, SupabaseCalendarStore, type CalendarStore, type DeviceDay } from './store';

export type CalendarCaller = Pick<CookingCaller, 'householdId' | 'userId' | 'client' | 'readOnly'>;

const DEFAULT_TZ = 'Europe/London';
const ICS_HORIZON_DAYS = 28;
const MAX_FEED_BYTES = 2 * 1024 * 1024;
const MIN_REFRESH_MS = 5 * 60 * 1000;
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

export const storeFor = (caller: Pick<CalendarCaller, 'client'>): CalendarStore => (caller.client ? new SupabaseCalendarStore(caller.client) : new MemoryCalendarStore());

const err = (error: CalendarError): { ok: false; error: CalendarError; message: string } => ({ ok: false, error, message: CALENDAR_ERROR_MESSAGE[error] });

function mapStoreError(e: unknown): { ok: false; error: CalendarError; message: string } {
  if (e instanceof CalendarStoreError) return err(e.code);
  return err('unknown');
}

const rejectedError = (e: UrlRejectedError): CalendarError => (e.code === 'BAD_URL' ? 'bad_url' : e.code === 'DNS_FAILED' ? 'unreachable' : 'blocked');
const tzOr = (tz: unknown): string => (typeof tz === 'string' && isValidTimeZone(tz) ? tz : DEFAULT_TZ);
const isDate = (s: unknown): s is string => typeof s === 'string' && parseIsoDate(s) !== null;
const dayNum = (iso: string): number => {
  const c = parseIsoDate(iso)!;
  return Date.UTC(c.y, c.m - 1, c.d) / 86_400_000;
};

/** The manual "busy" toggle on a day (any member, always available). */
export async function setManualBusy(caller: CalendarCaller, date: unknown, busy: unknown): Promise<CalendarResult> {
  if (caller.readOnly) return err('read_only');
  if (!isDate(date) || typeof busy !== 'boolean') return err('invalid_input');
  try {
    await storeFor(caller).setManual(caller.householdId, caller.userId, date, busy);
    return { ok: true };
  } catch (e) {
    return mapStoreError(e);
  }
}

export interface DeviceSyncInput {
  from: unknown;
  to: unknown;
  days: unknown;
}

/**
 * Android: the phone derived these flags from its own calendar. Only the derived numbers are accepted (date, busy,
 * minutes free); anything else in the body is ignored. Replaces the caller's own device flags in [from, to].
 */
export async function syncDeviceBusy(caller: CalendarCaller, input: DeviceSyncInput): Promise<CalendarResult<{ stored: number }>> {
  if (caller.readOnly) return err('read_only');
  const { from, to, days } = input;
  if (!isDate(from) || !isDate(to) || !Array.isArray(days) || days.length > 70) return err('invalid_input');
  if (dayNum(to) < dayNum(from) || dayNum(to) - dayNum(from) > 62) return err('invalid_input');
  const keep: DeviceDay[] = [];
  const seen = new Set<string>();
  for (const d of days) {
    if (typeof d !== 'object' || d === null) return err('invalid_input');
    const { date, busy, minutesAvailable } = d as Record<string, unknown>;
    if (!isDate(date) || typeof busy !== 'boolean' || seen.has(date)) return err('invalid_input');
    if (dayNum(date) < dayNum(from) || dayNum(date) > dayNum(to)) return err('invalid_input');
    if (!Number.isInteger(minutesAvailable) || (minutesAvailable as number) < 0 || (minutesAvailable as number) > 1440) return err('invalid_input');
    seen.add(date);
    if (busy) keep.push({ date, minutesAvailable: minutesAvailable as number });
  }
  try {
    await storeFor(caller).replaceOwn(caller.householdId, caller.userId, 'device', from, to, keep);
    return { ok: true, stored: keep.length };
  } catch (e) {
    return mapStoreError(e);
  }
}

/** Revoke: forget everything the device calendar contributed (the phone also turns its own switch off). */
export async function revokeDeviceCalendar(caller: CalendarCaller): Promise<CalendarResult> {
  if (caller.readOnly) return err('read_only');
  try {
    await storeFor(caller).clearOwn(caller.householdId, caller.userId, 'device');
    return { ok: true };
  } catch (e) {
    return mapStoreError(e);
  }
}

export async function calendarStatus(caller: Pick<CalendarCaller, 'householdId' | 'userId' | 'client'>): Promise<CalendarResult<{ status: CalendarStatus }>> {
  try {
    const s = storeFor(caller);
    const [feed, device] = await Promise.all([s.getFeed(caller.householdId, caller.userId), s.ownCount(caller.householdId, caller.userId, 'device')]);
    return { ok: true, status: { icsConfigured: !!feed, icsHost: feed?.hostHint ?? null, lastSyncedAt: feed?.lastSyncedAt ?? null, lastStatus: feed?.lastStatus ?? null, deviceFlagCount: device } };
  } catch (e) {
    return mapStoreError(e);
  }
}

/** webcal:// is just https:// for the same address. */
export function normaliseFeedUrl(raw: string): string {
  const t = raw.trim();
  return /^webcals?:\/\//i.test(t) ? t.replace(/^webcals?:\/\//i, 'https://') : t;
}

const aadFor = (householdId: string, userId: string): string => `calendar-feed:${householdId}:${userId}`;

export interface IcsDeps {
  now?: () => number;
  /** Test seam: replaces the network (the SSRF checks still run when the real guard is used). */
  fetchOptions?: Parameters<typeof guardedGet>[1];
}

function fetchOptionsFor(deps: IcsDeps): Parameters<typeof guardedGet>[1] {
  return { expect: 'calendar', maxBytes: MAX_FEED_BYTES, timeoutMs: 10_000, ...(deps.fetchOptions ?? (process.env.URL_IMPORT_SOURCE === 'mock' ? fixtureFetchOptions() : {})) };
}

/** Fetch a feed and reduce it to derived flags for the next 28 days. Never returns anything but numbers. */
async function readFeed(url: string, timeZone: string, deps: IcsDeps): Promise<{ ok: true; from: string; to: string; days: DeviceDay[] } | { ok: false; error: CalendarError }> {
  let body: Awaited<ReturnType<typeof guardedGet>>;
  try {
    body = await guardedGet(url, fetchOptionsFor(deps));
  } catch (e) {
    if (e instanceof UrlRejectedError) return { ok: false, error: rejectedError(e) };
    if (e instanceof FetchError && e.code === 'NOT_CALENDAR') return { ok: false, error: 'not_calendar' };
    console.error('[calendar-ics] fetch failed', e instanceof Error ? e.name : 'unknown'); // name only: the address is a secret
    return { ok: false, error: 'unreachable' };
  }
  const text = new TextDecoder('utf-8').decode(body.bytes);
  if (!/BEGIN:VCALENDAR/i.test(text)) return { ok: false, error: 'not_calendar' };
  const now = (deps.now ?? Date.now)();
  const today = toIsoDate(civilToday(now, timeZone));
  const dates: string[] = [];
  const t = parseIsoDate(today)!;
  for (let i = 0; i < ICS_HORIZON_DAYS; i++) dates.push(toIsoDate(addCivilDays(t, i)));
  const last = parseIsoDate(dates[dates.length - 1]!)!;
  const rangeStart = zonedToUtc(t.y, t.m, t.d, 0, 0, timeZone);
  const rangeEnd = zonedToUtc(last.y, last.m, last.d, 23, 59, timeZone) + 60_000;
  const { events } = parseIcs(text, { rangeStart, rangeEnd, defaultTimeZone: timeZone });
  const derived = deriveBusyDays(events, dates, { timeZone });
  return { ok: true, from: dates[0]!, to: dates[dates.length - 1]!, days: derived.filter((d) => d.busy).map((d) => ({ date: d.date, minutesAvailable: d.minutesAvailable })) };
}

function civilToday(ms: number, tz: string): { y: number; m: number; d: number } {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date(ms));
  const get = (k: string): number => Number(p.find((x) => x.type === k)?.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

const lastRefresh = new Map<string, number>();
export function resetIcsThrottle(): void {
  lastRefresh.clear();
}

/** Save the subscription address (after proving it works), then load the next 28 days of busy evenings from it. */
export async function saveIcsFeed(caller: CalendarCaller, rawUrl: unknown, timeZone: unknown, deps: IcsDeps = {}): Promise<CalendarResult<{ busyDays: number }>> {
  if (caller.readOnly) return err('read_only');
  if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0 || rawUrl.length > 2000) return err('bad_url');
  const url = normaliseFeedUrl(rawUrl);
  let parsed: ReturnType<typeof parseImportUrl>;
  try {
    parsed = parseImportUrl(url);
  } catch (e) {
    return err(e instanceof UrlRejectedError ? rejectedError(e) : 'bad_url');
  }
  let secret: string;
  try {
    secret = getAppSecret();
  } catch (e) {
    return err(e instanceof SettingsError ? 'no_secret' : 'unknown');
  }
  const tz = tzOr(timeZone);
  const read = await readFeed(url, tz, deps);
  if (!read.ok) return err(read.error);
  try {
    const store = storeFor(caller);
    await store.saveFeed(caller.householdId, caller.userId, { urlEncrypted: encryptSecret(url, secret, aadFor(caller.householdId, caller.userId)), hostHint: parsed.host });
    await store.replaceOwn(caller.householdId, caller.userId, 'ics', read.from, read.to, read.days);
    await store.touchFeed(caller.householdId, caller.userId, `ok: ${read.days.length} busy evening${read.days.length === 1 ? '' : 's'}`, new Date((deps.now ?? Date.now)()).toISOString());
    lastRefresh.set(`${caller.householdId}|${caller.userId}`, (deps.now ?? Date.now)());
    return { ok: true, busyDays: read.days.length };
  } catch (e) {
    return mapStoreError(e);
  }
}

/** Re-read the saved feed. `onlyIfStale` (page loads) skips it when it was read in the last 6 hours; always throttled to 1 per 5 min. */
export async function refreshIcsFeed(caller: CalendarCaller, timeZone: unknown, opts: { onlyIfStale?: boolean } & IcsDeps = {}): Promise<CalendarResult<{ busyDays: number }>> {
  if (caller.readOnly) return err('read_only');
  const nowMs = (opts.now ?? Date.now)();
  const key = `${caller.householdId}|${caller.userId}`;
  if (nowMs - (lastRefresh.get(key) ?? 0) < MIN_REFRESH_MS) return { ok: true, busyDays: -1 };
  try {
    const store = storeFor(caller);
    const feed = await store.getFeed(caller.householdId, caller.userId);
    if (!feed) return err('not_configured');
    if (opts.onlyIfStale && feed.lastSyncedAt && nowMs - Date.parse(feed.lastSyncedAt) < STALE_AFTER_MS) return { ok: true, busyDays: -1 };
    let url: string;
    try {
      url = decryptSecret(feed.urlEncrypted, getAppSecret(), aadFor(caller.householdId, caller.userId));
    } catch {
      return err('no_secret');
    }
    lastRefresh.set(key, nowMs);
    const read = await readFeed(url, tzOr(timeZone), opts);
    if (!read.ok) {
      await store.touchFeed(caller.householdId, caller.userId, `error: ${read.error}`, new Date(nowMs).toISOString());
      return err(read.error);
    }
    await store.replaceOwn(caller.householdId, caller.userId, 'ics', read.from, read.to, read.days);
    await store.touchFeed(caller.householdId, caller.userId, `ok: ${read.days.length} busy evening${read.days.length === 1 ? '' : 's'}`, new Date(nowMs).toISOString());
    return { ok: true, busyDays: read.days.length };
  } catch (e) {
    return mapStoreError(e);
  }
}

/** Remove the address and every flag that came from it. */
export async function removeIcsFeed(caller: CalendarCaller): Promise<CalendarResult> {
  if (caller.readOnly) return err('read_only');
  try {
    const store = storeFor(caller);
    await store.deleteFeed(caller.householdId, caller.userId);
    await store.clearOwn(caller.householdId, caller.userId, 'ics');
    lastRefresh.delete(`${caller.householdId}|${caller.userId}`);
    return { ok: true };
  } catch (e) {
    return mapStoreError(e);
  }
}
