// Client for /api/calendar (apps/web, P2-C D410-D415): the member's calendar connections and the Android device-calendar sync.
// Only derived flags go up (date, busy, minutes free); the ICS address goes up once when pasted and never comes back.
import type { ServerApi } from './serverApi';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

export interface CalendarStatus {
  icsConfigured: boolean;
  icsHost: string | null;
  lastSyncedAt: string | null;
  lastStatus: string | null;
  deviceFlagCount: number;
}

export interface DeviceDayFlag { date: string; busy: boolean; minutesAvailable: number }

export function parseStatus(v: unknown): CalendarStatus {
  const s = isObj(v) && isObj(v.status) ? v.status : {};
  return {
    icsConfigured: s.icsConfigured === true,
    icsHost: typeof s.icsHost === 'string' ? s.icsHost : null,
    lastSyncedAt: typeof s.lastSyncedAt === 'string' ? s.lastSyncedAt : null,
    lastStatus: typeof s.lastStatus === 'string' ? s.lastStatus : null,
    deviceFlagCount: typeof s.deviceFlagCount === 'number' && Number.isFinite(s.deviceFlagCount) ? Math.max(0, Math.floor(s.deviceFlagCount)) : 0,
  };
}

export interface CalendarClient {
  status(): Promise<CalendarStatus>;
  /** Replace this member's device flags in [from, to] with the derived `days` (non-busy days clear stale flags). */
  syncDevice(from: string, to: string, days: DeviceDayFlag[]): Promise<number>;
  revokeDevice(): Promise<void>;
  saveIcs(url: string, timeZone: string): Promise<number>;
  refreshIcs(timeZone: string): Promise<void>;
  removeIcs(): Promise<void>;
}

export function createCalendarClient(api: ServerApi, householdId: string): CalendarClient {
  const post = <T>(body: Obj): Promise<T> => api.post<T>('/api/calendar', { householdId, ...body });
  return {
    status: async () => parseStatus(await api.get<unknown>('/api/calendar', { householdId })),
    syncDevice: async (from, to, days) => {
      const r = await post<unknown>({ action: 'device_sync', from, to, days });
      return isObj(r) && typeof r.stored === 'number' ? r.stored : 0;
    },
    revokeDevice: async () => {
      await post({ action: 'device_revoke' });
    },
    saveIcs: async (url, timeZone) => {
      const r = await post<unknown>({ action: 'ics_save', url, timeZone });
      return isObj(r) && typeof r.busyDays === 'number' ? r.busyDays : 0;
    },
    refreshIcs: async (timeZone) => {
      await post({ action: 'ics_refresh', timeZone });
    },
    removeIcs: async () => {
      await post({ action: 'ics_remove' });
    },
  };
}
