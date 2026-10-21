// The phone's own calendar as a source of busy evenings (P2-C, D414). Opt-in, read-only, revocable.
//
// PRIVACY CONTRACT: events are reduced to { start, end, allDay, busy } right here (`toEvent` never reads a title, place or
// attendee), the busy / free answer for the 17:00-20:00 window is computed ON THE DEVICE with the shared engine, and only the
// derived flags (date, busy, minutes free) are sent to the server. Nothing else leaves the phone.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Calendar from 'expo-calendar';
import { addCivilDays, deriveBusyDays, parseIsoDate, toIsoDate, type CalendarEvent } from '@fr/engine/calendar';
import { createCalendarClient, type CalendarClient, type DeviceDayFlag } from './calendarApi';
import { localToday } from './leftoversApi';
import type { ServerApi } from './serverApi';

const KEY = 'fr.deviceCalendar.v1';
export const HORIZON_DAYS = 28;

export interface DeviceCalendarPrefs {
  /** The member switched "use my phone's calendar" on. Off by default. */
  enabled: boolean;
  lastSyncAt?: string;
}

export async function loadDeviceCalendarPrefs(): Promise<DeviceCalendarPrefs> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return { enabled: false };
    const v = JSON.parse(raw) as Partial<DeviceCalendarPrefs>;
    return { enabled: v.enabled === true, ...(typeof v.lastSyncAt === 'string' ? { lastSyncAt: v.lastSyncAt } : {}) };
  } catch {
    return { enabled: false };
  }
}

export async function saveDeviceCalendarPrefs(p: DeviceCalendarPrefs): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(p));
}

export type PermissionState = 'granted' | 'denied' | 'undetermined';

export async function permissionState(): Promise<PermissionState> {
  try {
    const r = await Calendar.getCalendarPermissionsAsync();
    return r.status === 'granted' ? 'granted' : r.status === 'denied' ? 'denied' : 'undetermined';
  } catch {
    return 'denied';
  }
}

export async function requestPermission(): Promise<PermissionState> {
  try {
    const r = await Calendar.requestCalendarPermissionsAsync();
    return r.status === 'granted' ? 'granted' : r.status === 'denied' ? 'denied' : 'undetermined';
  } catch {
    return 'denied';
  }
}

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London';
  } catch {
    return 'Europe/London';
  }
}

/** The ONLY place a device event is read. No title, notes, location or attendees are touched. */
export function toEvent(e: { startDate: string | Date; endDate: string | Date; allDay?: boolean; availability?: string; status?: string }): CalendarEvent {
  return {
    start: new Date(e.startDate).getTime(),
    end: new Date(e.endDate).getTime(),
    allDay: e.allDay === true,
    busy: e.availability !== Calendar.Availability.FREE && e.status !== Calendar.EventStatus.CANCELED,
  };
}

export async function readEvents(from: Date, to: Date): Promise<CalendarEvent[]> {
  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const ids = calendars.map((c) => c.id).filter((id): id is string => typeof id === 'string');
  if (ids.length === 0) return [];
  const events = await Calendar.getEventsAsync(ids, from, to);
  return events.map(toEvent).filter((e) => Number.isFinite(e.start) && Number.isFinite(e.end));
}

export interface DevicePayload { from: string; to: string; days: DeviceDayFlag[] }

/** Busy / free for the next `horizon` evenings, computed on the phone. `read` is injectable for tests. */
export async function deriveDevicePayload(
  today = localToday(),
  horizon = HORIZON_DAYS,
  read: (from: Date, to: Date) => Promise<CalendarEvent[]> = readEvents,
  timeZone = deviceTimeZone(),
): Promise<DevicePayload> {
  const start = parseIsoDate(today);
  if (!start) throw new Error('bad date');
  const dates = Array.from({ length: horizon }, (_, i) => toIsoDate(addCivilDays(start, i)));
  // A day either side so evening events that cross midnight and time-zone edges are included.
  const events = await read(new Date(`${toIsoDate(addCivilDays(start, -1))}T00:00:00`), new Date(`${toIsoDate(addCivilDays(start, horizon + 1))}T00:00:00`));
  const derived = deriveBusyDays(events, dates, { timeZone });
  return { from: dates[0]!, to: dates[dates.length - 1]!, days: derived.map((d) => ({ date: d.date, busy: d.busy, minutesAvailable: d.minutesAvailable })) };
}

export type SyncOutcome = { ok: true; busyDays: number } | { ok: false; reason: 'off' | 'no_permission' | 'error' };

/** Sync now if the member opted in and the permission is still granted. Never throws; a failure just means the flags are not refreshed. */
export async function syncDeviceCalendar(api: ServerApi, householdId: string, deps: { client?: CalendarClient; read?: (from: Date, to: Date) => Promise<CalendarEvent[]> } = {}): Promise<SyncOutcome> {
  try {
    const prefs = await loadDeviceCalendarPrefs();
    if (!prefs.enabled) return { ok: false, reason: 'off' };
    if ((await permissionState()) !== 'granted') return { ok: false, reason: 'no_permission' };
    const payload = await deriveDevicePayload(localToday(), HORIZON_DAYS, deps.read);
    await (deps.client ?? createCalendarClient(api, householdId)).syncDevice(payload.from, payload.to, payload.days);
    await saveDeviceCalendarPrefs({ enabled: true, lastSyncAt: new Date().toISOString() });
    return { ok: true, busyDays: payload.days.filter((d) => d.busy).length };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

/** Switch on: ask for the permission (Android shows its own prompt), remember the choice, sync. */
export async function enableDeviceCalendar(api: ServerApi, householdId: string, deps: { client?: CalendarClient; read?: (from: Date, to: Date) => Promise<CalendarEvent[]> } = {}): Promise<{ state: PermissionState; busyDays?: number }> {
  const state = (await permissionState()) === 'granted' ? 'granted' : await requestPermission();
  if (state !== 'granted') return { state };
  await saveDeviceCalendarPrefs({ enabled: true });
  const r = await syncDeviceCalendar(api, householdId, deps);
  return r.ok ? { state, busyDays: r.busyDays } : { state };
}

/** Switch off and forget: the server deletes this member's device flags; the phone stops reading the calendar. */
export async function disableDeviceCalendar(api: ServerApi, householdId: string, deps: { client?: CalendarClient } = {}): Promise<void> {
  await (deps.client ?? createCalendarClient(api, householdId)).revokeDevice();
  await saveDeviceCalendarPrefs({ enabled: false });
}
