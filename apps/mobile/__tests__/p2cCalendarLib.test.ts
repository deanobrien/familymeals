// P2-C (D410-D419) on Android: the device calendar is reduced to derived flags ON THE PHONE; the leftovers / plan parsers are defensive.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Calendar from 'expo-calendar';
import type { CalendarClient } from '@/lib/calendarApi';
import {
  deriveDevicePayload, disableDeviceCalendar, enableDeviceCalendar, loadDeviceCalendarPrefs, syncDeviceCalendar, toEvent,
} from '@/lib/calendarDevice';
import { parseBusyApplied, parseBusyDays, parseLeftoversView } from '@/lib/leftoversApi';
import { parseDoc, parsePage, parseProposal } from '@/lib/planApi';
import { setLeftover } from '@/lib/plan/ops';
import type { PlanDoc } from '@/lib/plan/types';
import { zonedToUtc } from '@fr/engine/calendar';
import { pageJson, PROPOSAL } from './helpers/planFixtures';

const state = (Calendar as unknown as { __state: { permission: string; events: unknown[]; calendars: unknown[] } }).__state;
const ev = (start: string, end: string, extra: Record<string, unknown> = {}) => ({
  startDate: new Date(zonedToUtc(+start.slice(0, 4), +start.slice(5, 7), +start.slice(8, 10), +start.slice(11, 13), +start.slice(14, 16), 'Europe/London')).toISOString(),
  endDate: new Date(zonedToUtc(+end.slice(0, 4), +end.slice(5, 7), +end.slice(8, 10), +end.slice(11, 13), +end.slice(14, 16), 'Europe/London')).toISOString(),
  allDay: false, availability: 'busy', status: 'confirmed', title: 'Therapy with Dr X', notes: 'private', location: 'Clinic', attendees: [{ email: 'dr@example.org' }], ...extra,
});

function fakeClient() {
  const calls: unknown[][] = [];
  const client: CalendarClient = {
    status: async () => ({ icsConfigured: false, icsHost: null, lastSyncedAt: null, lastStatus: null, deviceFlagCount: 0 }),
    syncDevice: async (from, to, days) => { calls.push(['sync', from, to, days]); return days.filter((d) => d.busy).length; },
    revokeDevice: async () => { calls.push(['revoke']); },
    saveIcs: async () => 0, refreshIcs: async () => undefined, removeIcs: async () => undefined,
  };
  return { client, calls };
}
const api = { configured: true } as never;

beforeEach(async () => {
  await AsyncStorage.clear();
  state.permission = 'undetermined';
  state.events = [];
});

describe('device calendar: derived on the phone', () => {
  it('toEvent keeps only start, end, all-day and busy: no title, place, notes or attendees', () => {
    const e = toEvent(ev('2026-10-21T18:00', '2026-10-21T19:00') as never);
    expect(Object.keys(e).sort()).toEqual(['allDay', 'busy', 'end', 'start']);
    expect(JSON.stringify(e)).not.toMatch(/therapy|clinic|dr@|private/i);
    expect(toEvent(ev('2026-10-21T18:00', '2026-10-21T19:00', { availability: 'free' }) as never).busy).toBe(false);
    expect(toEvent(ev('2026-10-21T18:00', '2026-10-21T19:00', { status: 'canceled' }) as never).busy).toBe(false);
  });

  it('computes busy flags and minutes free for the 17:00-20:00 window (merge, clip, all-day ignored)', async () => {
    const events = [
      ev('2026-10-21T18:00', '2026-10-21T19:30'),
      ev('2026-10-21T18:30', '2026-10-21T19:00'), // nested: counted once
      ev('2026-10-22T09:00', '2026-10-22T17:30'), // clipped: 30 min
      ev('2026-10-23T00:00', '2026-10-24T00:00', { allDay: true }),
    ].map((e) => toEvent(e as never));
    const p = await deriveDevicePayload('2026-10-21', 4, async () => events, 'Europe/London');
    expect(p).toMatchObject({ from: '2026-10-21', to: '2026-10-24' });
    expect(p.days).toEqual([
      { date: '2026-10-21', busy: true, minutesAvailable: 90 },
      { date: '2026-10-22', busy: false, minutesAvailable: 150 },
      { date: '2026-10-23', busy: false, minutesAvailable: 180 },
      { date: '2026-10-24', busy: false, minutesAvailable: 180 },
    ]);
    expect(Object.keys(p.days[0]!).sort()).toEqual(['busy', 'date', 'minutesAvailable']);
  });

  it('handles the clocks changing (29 Mar 2026): window still 3 real hours', async () => {
    const events = [toEvent(ev('2026-03-29T18:00', '2026-03-29T19:30') as never)];
    const p = await deriveDevicePayload('2026-03-29', 1, async () => events, 'Europe/London');
    expect(p.days[0]).toEqual({ date: '2026-03-29', busy: true, minutesAvailable: 90 });
  });
});

describe('device calendar: opt-in, permission, revoke', () => {
  it('is OFF by default and syncs nothing', async () => {
    const { client, calls } = fakeClient();
    expect(await loadDeviceCalendarPrefs()).toEqual({ enabled: false });
    expect(await syncDeviceCalendar(api, 'hh', { client, read: async () => [] })).toEqual({ ok: false, reason: 'off' });
    expect(calls).toEqual([]);
  });

  it('turning it on asks for the permission, remembers the choice and syncs only derived flags', async () => {
    state.events = [ev('2026-10-21T18:00', '2026-10-21T19:30')];
    const r = await enableDeviceCalendar(api, 'hh');
    expect(r.state).toBe('granted');
    expect(Calendar.requestCalendarPermissionsAsync).toHaveBeenCalled();
    expect((await loadDeviceCalendarPrefs()).enabled).toBe(true);
  });

  it('a refused permission leaves it off and sends nothing', async () => {
    state.permission = 'denied';
    const r = await enableDeviceCalendar(api, 'hh');
    expect(r.state).toBe('denied');
    expect((await loadDeviceCalendarPrefs()).enabled).toBe(false);
  });

  it('syncs when on and permitted, and stops quietly if the permission was taken away', async () => {
    const { client, calls } = fakeClient();
    state.permission = 'granted';
    await AsyncStorage.setItem('fr.deviceCalendar.v1', JSON.stringify({ enabled: true }));
    const events = [toEvent(ev(`${new Date().getFullYear() + 1}-01-05T18:00`, `${new Date().getFullYear() + 1}-01-05T19:30`) as never)];
    expect(await syncDeviceCalendar(api, 'hh', { client, read: async () => events })).toMatchObject({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe('sync');
    state.permission = 'denied';
    expect(await syncDeviceCalendar(api, 'hh', { client, read: async () => events })).toEqual({ ok: false, reason: 'no_permission' });
    expect(calls).toHaveLength(1);
  });

  it('turning it off deletes the server flags and the opt-in', async () => {
    const { client, calls } = fakeClient();
    await AsyncStorage.setItem('fr.deviceCalendar.v1', JSON.stringify({ enabled: true }));
    await disableDeviceCalendar(api, 'hh', { client });
    expect(calls).toEqual([['revoke']]);
    expect((await loadDeviceCalendarPrefs()).enabled).toBe(false);
  });
});

describe('parsers', () => {
  it('busy days and applied days keep only valid, derived fields', () => {
    expect(parseBusyDays([{ date: '2026-10-21', sources: ['manual', 3], minutesAvailable: 45, skip: false, label: 'Busy (about 45 min free)', title: 'x' }, { date: 'bad' }])).toEqual([
      { date: '2026-10-21', sources: ['manual'], minutesAvailable: 45, skip: false, label: 'Busy (about 45 min free)' },
    ]);
    expect(parseBusyApplied([{ date: '2026-10-22', skip: true, minutesAvailable: null, sources: ['ics'] }, 'no'])).toEqual([{ date: '2026-10-22', skip: true, minutesAvailable: null, sources: ['ics'] }]);
    expect(parseBusyDays('nope')).toEqual([]);
  });

  it('leftovers view drops malformed batches and suggestions', () => {
    const v = parseLeftoversView({
      batches: [{ id: 'b1', title: 'Chilli', storedIn: 'freezer', portionsMade: 4, portionsLeft: 3, portionsPlanned: 1, portionsFree: 2, cookedOn: '2026-10-01', useBy: '2027-01-01', status: 'use_soon', useByLabel: 'Best by Fri 1 Jan' }, { id: 'x' }],
      suggestions: [{ batchId: 'b1', title: 'Chilli', storedIn: 'freezer', portions: 2, date: '2026-10-22', mealType: 'dinner', label: 'Freezer meal: Chilli, 2 portions', reason: 'A busy evening' }, { batchId: 'b1', mealType: 'brunch' }],
      titles: { b1: 'Chilli', b2: 5 },
    });
    expect(v.batches).toHaveLength(1);
    expect(v.batches[0]).toMatchObject({ storedIn: 'freezer', status: 'use_soon', portionsFree: 2 });
    expect(v.suggestions).toHaveLength(1);
    expect(v.titles).toEqual({ b1: 'Chilli' });
    expect(parseLeftoversView(null)).toEqual({ batches: [], suggestions: [], titles: {} });
  });

  it('plan page carries busy, leftovers and eaten slots; entries keep batch + portions', () => {
    const page = parsePage(pageJson(undefined, {
      busy: [{ date: '2026-10-21', sources: ['device'], minutesAvailable: 30, skip: false, label: 'Busy (about 30 min free)' }],
      leftovers: { batches: [], suggestions: [], titles: { b1: 'Chilli' } }, eatenSlots: ['2026-10-22|dinner'],
    }, { entries: { '2026-10-22|dinner': { kind: 'leftovers', batchId: 'b1', portions: 2 }, '2026-10-23|dinner': { kind: 'leftovers' } } }));
    expect(page.busy).toHaveLength(1);
    expect(page.eatenSlots).toEqual(['2026-10-22|dinner']);
    expect(page.doc.entries['2026-10-22|dinner']).toEqual({ kind: 'leftovers', batchId: 'b1', portions: 2 });
    expect(page.doc.entries['2026-10-23|dinner']).toEqual({ kind: 'leftovers' });
    expect(parsePage(pageJson(undefined)).busy).toEqual([]);
  });

  it('proposal carries busyApplied', () => {
    const p = parseProposal({ ...PROPOSAL.proposal, busyApplied: [{ date: '2026-10-22', skip: false, minutesAvailable: 30, sources: ['manual'] }] });
    expect(p.busyApplied).toHaveLength(1);
    expect(parseProposal(PROPOSAL.proposal).busyApplied).toEqual([]);
  });

  it('setLeftover puts a batch in a slot and parseDoc round-trips it', () => {
    const doc = parseDoc({ id: 'p', weekStart: '2026-10-19', mealTypes: ['dinner'], entries: {}, status: 'approved' }) as PlanDoc;
    const next = setLeftover(doc, { date: '2026-10-22', mealType: 'dinner' }, 'b1', 2);
    expect(next.status).toBe('draft');
    expect(parseDoc(next)!.entries['2026-10-22|dinner']).toEqual({ kind: 'leftovers', batchId: 'b1', portions: 2 });
  });
});
