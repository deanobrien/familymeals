import { describe, expect, it } from 'vitest';
import { busyAdjustments, busyLabel, deriveBusyDays, mergeBusyDays, tzOffsetMs, zonedToUtc, type CalendarEvent } from '../../src/calendar/index';

const LON = 'Europe/London';
const at = (iso: string, tz = LON): number => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(iso)!;
  return zonedToUtc(+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!, tz);
};
const ev = (s: string, e: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({ start: at(s), end: at(e), allDay: false, busy: true, ...extra });
const derive = (events: CalendarEvent[], dates: string[]) => deriveBusyDays(events, dates, { timeZone: LON });

describe('time zone helpers', () => {
  it('knows London is UTC+1 in summer and UTC+0 in winter', () => {
    expect(tzOffsetMs(Date.UTC(2026, 6, 1, 12), LON)).toBe(3_600_000);
    expect(tzOffsetMs(Date.UTC(2026, 0, 1, 12), LON)).toBe(0);
  });
  it('converts wall time to the right instant on both sides of a DST change', () => {
    expect(new Date(at('2026-03-28T18:00')).toISOString()).toBe('2026-03-28T18:00:00.000Z'); // GMT
    expect(new Date(at('2026-03-29T18:00')).toISOString()).toBe('2026-03-29T17:00:00.000Z'); // BST (clocks went forward at 01:00)
    expect(new Date(at('2026-10-25T18:00')).toISOString()).toBe('2026-10-25T18:00:00.000Z'); // GMT again
    expect(new Date(at('2026-10-24T18:00')).toISOString()).toBe('2026-10-24T17:00:00.000Z');
  });
  it('maps a non-existent spring-forward time forward by the gap', () => {
    expect(new Date(at('2026-03-29T01:30')).toISOString()).toBe('2026-03-29T01:30:00.000Z'); // 02:30 BST
  });
  it('works in a zone with a different offset', () => {
    expect(new Date(zonedToUtc(2026, 1, 15, 17, 0, 'Asia/Kolkata')).toISOString()).toBe('2026-01-15T11:30:00.000Z');
  });
});

describe('deriveBusyDays', () => {
  it('a free evening is not busy and has the whole window free', () => {
    const [d] = derive([], ['2026-10-21']);
    expect(d).toEqual({ date: '2026-10-21', busyMinutes: 0, minutesAvailable: 180, busy: false });
  });

  it('an event inside the window counts its minutes; 60+ makes the day busy', () => {
    const [a, b] = derive([ev('2026-10-21T18:00', '2026-10-21T18:30'), ev('2026-10-22T18:00', '2026-10-22T19:30')], ['2026-10-21', '2026-10-22']);
    expect(a).toMatchObject({ busyMinutes: 30, minutesAvailable: 150, busy: false });
    expect(b).toMatchObject({ busyMinutes: 90, minutesAvailable: 90, busy: true });
  });

  it('clips events to the 17:00-20:00 window', () => {
    const [d] = derive([ev('2026-10-21T09:00', '2026-10-21T17:30'), ev('2026-10-21T19:30', '2026-10-21T23:00')], ['2026-10-21']);
    expect(d!.busyMinutes).toBe(60);
    expect(d!.busy).toBe(true);
  });

  it('ignores events that end before or start after the window', () => {
    const [d] = derive([ev('2026-10-21T09:00', '2026-10-21T17:00'), ev('2026-10-21T20:00', '2026-10-21T22:00')], ['2026-10-21']);
    expect(d!.busyMinutes).toBe(0);
  });

  it('merges overlapping and nested events so time is counted once', () => {
    const [d] = derive(
      [ev('2026-10-21T17:00', '2026-10-21T18:30'), ev('2026-10-21T18:00', '2026-10-21T19:00'), ev('2026-10-21T17:30', '2026-10-21T17:45')],
      ['2026-10-21'],
    );
    expect(d!.busyMinutes).toBe(120); // 17:00-19:00
    expect(d!.minutesAvailable).toBe(60);
  });

  it('counts back-to-back events without double counting the join', () => {
    const [d] = derive([ev('2026-10-21T17:00', '2026-10-21T18:00'), ev('2026-10-21T18:00', '2026-10-21T19:00')], ['2026-10-21']);
    expect(d!.busyMinutes).toBe(120);
  });

  it('ignores all-day events (they carry no time of day) and events marked free', () => {
    const [d] = derive(
      [ev('2026-10-21T00:00', '2026-10-22T00:00', { allDay: true }), ev('2026-10-21T17:00', '2026-10-21T20:00', { busy: false })],
      ['2026-10-21'],
    );
    expect(d).toMatchObject({ busyMinutes: 0, busy: false });
  });

  it('a multi-day timed event busies every evening it spans', () => {
    const e = ev('2026-10-21T12:00', '2026-10-23T12:00');
    const days = derive([e], ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']);
    expect(days.map((d) => d.busy)).toEqual([false, true, true, false]);
  });

  it('measures the window correctly across a DST change day (clocks forward 29 Mar 2026)', () => {
    // 18:00-19:30 local on the change day is 17:00Z-18:30Z; the window itself is still 3 real hours (16:00Z-19:00Z).
    const [d] = derive([ev('2026-03-29T18:00', '2026-03-29T19:30')], ['2026-03-29']);
    expect(d).toMatchObject({ busyMinutes: 90, minutesAvailable: 90, busy: true });
  });

  it('measures the window correctly when the clocks go back (25 Oct 2026)', () => {
    const [d] = derive([ev('2026-10-25T17:00', '2026-10-25T17:45')], ['2026-10-25']);
    expect(d).toMatchObject({ busyMinutes: 45, busy: false });
  });

  it('reads the window in the stated zone, not the server zone', () => {
    // A 18:00 London meeting is 22:30 in Kolkata: outside a Kolkata evening window.
    const ny = deriveBusyDays([ev('2026-10-21T18:00', '2026-10-21T19:30')], ['2026-10-21'], { timeZone: 'Asia/Kolkata' });
    expect(ny[0]!.busyMinutes).toBe(0);
  });

  it('honours a custom window and threshold', () => {
    const [d] = deriveBusyDays([ev('2026-10-21T18:00', '2026-10-21T18:40')], ['2026-10-21'], { timeZone: LON, windowStart: '18:00', windowEnd: '19:00', minBusyMinutes: 30 });
    expect(d).toMatchObject({ busyMinutes: 40, minutesAvailable: 20, busy: true });
  });

  it('skips malformed dates and degenerate events', () => {
    const out = derive([{ start: NaN, end: 1, allDay: false, busy: true }, { start: 5, end: 5, allDay: false, busy: true }], ['not-a-date', '2026-10-21']);
    expect(out).toHaveLength(1);
    expect(out[0]!.busyMinutes).toBe(0);
  });

  it('never exposes anything but derived numbers', () => {
    const [d] = derive([{ ...ev('2026-10-21T18:00', '2026-10-21T19:30'), title: 'Therapy with Dr X' } as CalendarEvent], ['2026-10-21']);
    expect(Object.keys(d!).sort()).toEqual(['busy', 'busyMinutes', 'date', 'minutesAvailable']);
  });
});

describe('merging flags into planner adjustments', () => {
  it('manual toggle: quick meal (no number known)', () => {
    expect(busyAdjustments([{ date: '2026-10-21', source: 'manual', minutesAvailable: null }])).toEqual({ quickDates: ['2026-10-21'], skipDates: [] });
  });
  it('a tiny free window skips the dinner instead', () => {
    expect(busyAdjustments([{ date: '2026-10-21', source: 'device', minutesAvailable: 10 }])).toEqual({ quickDates: [], skipDates: ['2026-10-21'] });
    expect(busyAdjustments([{ date: '2026-10-21', source: 'ics', minutesAvailable: 20 }]).quickDates).toEqual(['2026-10-21']);
  });
  it('two sources for one day: the busier one wins, sources are combined', () => {
    const merged = mergeBusyDays([
      { date: '2026-10-21', source: 'manual', minutesAvailable: null },
      { date: '2026-10-21', source: 'device', minutesAvailable: 90 },
      { date: '2026-10-21', source: 'ics', minutesAvailable: 15 },
    ]);
    expect(merged).toEqual([{ date: '2026-10-21', sources: ['device', 'ics', 'manual'], minutesAvailable: 15, skip: true }]);
  });
  it('restricts to the plan days and labels without titles', () => {
    const days = [{ date: '2026-10-21', source: 'device' as const, minutesAvailable: 60 }, { date: '2026-11-30', source: 'manual' as const, minutesAvailable: null }];
    expect(busyAdjustments(days, ['2026-10-21', '2026-10-22']).quickDates).toEqual(['2026-10-21']);
    expect(busyLabel(mergeBusyDays(days)[0]!)).toBe('Busy (about 60 min free)');
  });
});
