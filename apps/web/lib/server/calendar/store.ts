// Storage for derived busy flags and the member's ICS feed (P2-C, D410-D415). Supabase (as the signed-in user, RLS decides)
// or an in-memory demo store. Nothing here ever holds an event title.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BusyDay } from '@fr/engine/calendar';

export class CalendarStoreError extends Error {
  constructor(readonly code: 'forbidden' | 'invalid_input' | 'unknown') {
    super(code);
    this.name = 'CalendarStoreError';
  }
}

export interface FeedRow {
  urlEncrypted: string;
  hostHint: string;
  lastSyncedAt: string | null;
  lastStatus: string | null;
}

export interface DeviceDay { date: string; minutesAvailable: number }

export interface CalendarStore {
  /** Household busy flags with from <= date <= to (inclusive). */
  busyBetween(householdId: string, from: string, to: string): Promise<BusyDay[]>;
  setManual(householdId: string, userId: string, date: string, busy: boolean): Promise<void>;
  /** Replace the caller's own flags of one source inside [from, to] with exactly `days`. */
  replaceOwn(householdId: string, userId: string, source: 'device' | 'ics', from: string, to: string, days: readonly DeviceDay[]): Promise<void>;
  clearOwn(householdId: string, userId: string, source: 'device' | 'ics'): Promise<void>;
  ownCount(householdId: string, userId: string, source: 'device' | 'ics'): Promise<number>;
  getFeed(householdId: string, userId: string): Promise<FeedRow | null>;
  saveFeed(householdId: string, userId: string, feed: { urlEncrypted: string; hostHint: string }): Promise<void>;
  touchFeed(householdId: string, userId: string, status: string, at: string): Promise<void>;
  deleteFeed(householdId: string, userId: string): Promise<void>;
}

type Row = Record<string, unknown>;

function fail(e: unknown): never {
  const code = (e as { code?: string } | null)?.code;
  if (code === '42501' || code === 'PGRST301') throw new CalendarStoreError('forbidden');
  if (code === '23514' || code === '22P02') throw new CalendarStoreError('invalid_input');
  throw new CalendarStoreError('unknown');
}

async function run<T>(p: PromiseLike<{ data: T | null; error: unknown }>): Promise<T | null> {
  const { data, error } = await p;
  if (error) fail(error);
  return data;
}

export class SupabaseCalendarStore implements CalendarStore {
  constructor(private readonly db: SupabaseClient) {}

  async busyBetween(householdId: string, from: string, to: string): Promise<BusyDay[]> {
    const rows = await run<Row[]>(this.db.from('plan_busy_days').select('day, source, minutes_available').eq('household_id', householdId).gte('day', from).lte('day', to));
    return (rows ?? []).map((r) => ({ date: String(r.day), source: r.source as BusyDay['source'], minutesAvailable: r.minutes_available === null ? null : Number(r.minutes_available) }));
  }

  async setManual(householdId: string, userId: string, date: string, busy: boolean): Promise<void> {
    if (busy) {
      await run(this.db.from('plan_busy_days').upsert({ household_id: householdId, day: date, source: 'manual', user_id: userId, minutes_available: null }, { onConflict: 'household_id,day,source,user_id' }));
    } else {
      await run(this.db.from('plan_busy_days').delete().eq('household_id', householdId).eq('day', date).eq('source', 'manual'));
    }
  }

  async replaceOwn(householdId: string, userId: string, source: 'device' | 'ics', from: string, to: string, days: readonly DeviceDay[]): Promise<void> {
    await run(this.db.from('plan_busy_days').delete().eq('household_id', householdId).eq('user_id', userId).eq('source', source).gte('day', from).lte('day', to));
    if (days.length === 0) return;
    await run(this.db.from('plan_busy_days').insert(days.map((d) => ({ household_id: householdId, day: d.date, source, user_id: userId, minutes_available: d.minutesAvailable }))));
  }

  async clearOwn(householdId: string, userId: string, source: 'device' | 'ics'): Promise<void> {
    await run(this.db.from('plan_busy_days').delete().eq('household_id', householdId).eq('user_id', userId).eq('source', source));
  }

  async ownCount(householdId: string, userId: string, source: 'device' | 'ics'): Promise<number> {
    const rows = await run<Row[]>(this.db.from('plan_busy_days').select('day').eq('household_id', householdId).eq('user_id', userId).eq('source', source));
    return rows?.length ?? 0;
  }

  async getFeed(householdId: string, userId: string): Promise<FeedRow | null> {
    const rows = await run<Row[]>(this.db.from('member_calendar_feeds').select('url_encrypted, host_hint, last_synced_at, last_status').eq('household_id', householdId).eq('user_id', userId));
    const r = rows?.[0];
    return r ? { urlEncrypted: String(r.url_encrypted), hostHint: String(r.host_hint), lastSyncedAt: r.last_synced_at ? String(r.last_synced_at) : null, lastStatus: r.last_status ? String(r.last_status) : null } : null;
  }

  async saveFeed(householdId: string, userId: string, feed: { urlEncrypted: string; hostHint: string }): Promise<void> {
    await run(this.db.from('member_calendar_feeds').upsert({ household_id: householdId, user_id: userId, url_encrypted: feed.urlEncrypted, host_hint: feed.hostHint, last_synced_at: null, last_status: null }, { onConflict: 'household_id,user_id' }));
  }

  async touchFeed(householdId: string, userId: string, status: string, at: string): Promise<void> {
    await run(this.db.from('member_calendar_feeds').update({ last_synced_at: at, last_status: status.slice(0, 80) }).eq('household_id', householdId).eq('user_id', userId));
  }

  async deleteFeed(householdId: string, userId: string): Promise<void> {
    await run(this.db.from('member_calendar_feeds').delete().eq('household_id', householdId).eq('user_id', userId));
  }
}

interface MemHousehold {
  busy: (BusyDay & { userId: string })[];
  feeds: Map<string, FeedRow>;
}
const g = globalThis as { __frCalendarMemory?: Map<string, MemHousehold> };
const map = (): Map<string, MemHousehold> => (g.__frCalendarMemory ??= new Map());
const mem = (h: string): MemHousehold => {
  let m = map().get(h);
  if (!m) map().set(h, (m = { busy: [], feeds: new Map() }));
  return m;
};

export function resetMemoryCalendar(): void {
  g.__frCalendarMemory = undefined;
}

/** In-memory demo store (mock auth mode): per household, lost on restart, cleared by the dev reset. */
export class MemoryCalendarStore implements CalendarStore {
  async busyBetween(h: string, from: string, to: string): Promise<BusyDay[]> {
    return mem(h).busy.filter((b) => b.date >= from && b.date <= to).map(({ userId: _u, ...b }) => ({ ...b }));
  }
  async setManual(h: string, userId: string, date: string, busy: boolean): Promise<void> {
    const m = mem(h);
    m.busy = m.busy.filter((b) => !(b.date === date && b.source === 'manual'));
    if (busy) m.busy.push({ date, source: 'manual', minutesAvailable: null, userId });
  }
  async replaceOwn(h: string, userId: string, source: 'device' | 'ics', from: string, to: string, days: readonly DeviceDay[]): Promise<void> {
    const m = mem(h);
    m.busy = m.busy.filter((b) => !(b.userId === userId && b.source === source && b.date >= from && b.date <= to));
    for (const d of days) m.busy.push({ date: d.date, source, minutesAvailable: d.minutesAvailable, userId });
  }
  async clearOwn(h: string, userId: string, source: 'device' | 'ics'): Promise<void> {
    const m = mem(h);
    m.busy = m.busy.filter((b) => !(b.userId === userId && b.source === source));
  }
  async ownCount(h: string, userId: string, source: 'device' | 'ics'): Promise<number> {
    return mem(h).busy.filter((b) => b.userId === userId && b.source === source).length;
  }
  async getFeed(h: string, userId: string): Promise<FeedRow | null> {
    const f = mem(h).feeds.get(userId);
    return f ? { ...f } : null;
  }
  async saveFeed(h: string, userId: string, feed: { urlEncrypted: string; hostHint: string }): Promise<void> {
    mem(h).feeds.set(userId, { ...feed, lastSyncedAt: null, lastStatus: null });
  }
  async touchFeed(h: string, userId: string, status: string, at: string): Promise<void> {
    const f = mem(h).feeds.get(userId);
    if (f) mem(h).feeds.set(userId, { ...f, lastSyncedAt: at, lastStatus: status });
  }
  async deleteFeed(h: string, userId: string): Promise<void> {
    mem(h).feeds.delete(userId);
  }
}
