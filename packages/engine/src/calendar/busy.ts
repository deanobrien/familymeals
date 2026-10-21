// Busy-window derivation (P2-C, D411). Turns calendar events into "how much of the evening window is free" per day.
// It runs ON THE DEVICE for the Android calendar and on the server for ICS feeds; either way only the derived numbers
// leave this function: events are reduced to start / end / all-day / busy and carry NO title, place or attendees.
import { parseIsoDate, zonedToUtc, type CivilDate } from './tz';

export interface CalendarEvent {
  /** Epoch ms. */
  start: number;
  end: number;
  /** All-day events have no time of day, so they never make an evening busy (documented limit, D411). */
  allDay: boolean;
  /** false = marked free / transparent: ignored. */
  busy: boolean;
}

export interface BusyOptions {
  /** IANA zone the days and the window are read in. */
  timeZone: string;
  /** Local "HH:MM". Default 17:00 - 20:00. */
  windowStart?: string;
  windowEnd?: string;
  /** A day counts as busy when at least this many minutes of the window are taken. Default 60. */
  minBusyMinutes?: number;
}

export interface DerivedBusyDay {
  date: string;
  busyMinutes: number;
  /** Free minutes left in the window. */
  minutesAvailable: number;
  busy: boolean;
}

export const DEFAULT_WINDOW_START = '17:00';
export const DEFAULT_WINDOW_END = '20:00';
export const DEFAULT_MIN_BUSY_MINUTES = 60;

function hm(text: string, fallback: string): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text) ?? /^(\d{1,2}):(\d{2})$/.exec(fallback)!;
  return [Math.min(23, Number(m[1])), Math.min(59, Number(m[2]))];
}

/** Union length (ms) of [s,e) intervals after clipping to [lo,hi). */
export function unionLengthMs(intervals: readonly (readonly [number, number])[], lo: number, hi: number): number {
  const clipped = intervals
    .map(([s, e]) => [Math.max(s, lo), Math.min(e, hi)] as const)
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curS = 0;
  let curE = -Infinity;
  for (const [s, e] of clipped) {
    if (s > curE) {
      if (curE > curS) total += curE - curS;
      curS = s;
      curE = e;
    } else if (e > curE) curE = e;
  }
  if (curE > curS) total += curE - curS;
  return total;
}

/**
 * For each ISO date (read in `opts.timeZone`) compute busy minutes inside the evening window. Overlapping events are merged
 * (two meetings at once block the time once), events are clipped to the window, free / all-day events are ignored. The
 * window is measured in real elapsed time, so a DST change day is handled by converting the local window edges to instants.
 */
export function deriveBusyDays(events: readonly CalendarEvent[], dates: readonly string[], opts: BusyOptions): DerivedBusyDay[] {
  const [sh, sm] = hm(opts.windowStart ?? DEFAULT_WINDOW_START, DEFAULT_WINDOW_START);
  const [eh, em] = hm(opts.windowEnd ?? DEFAULT_WINDOW_END, DEFAULT_WINDOW_END);
  const minBusy = opts.minBusyMinutes ?? DEFAULT_MIN_BUSY_MINUTES;
  const real = events.filter((e) => !e.allDay && e.busy && Number.isFinite(e.start) && Number.isFinite(e.end) && e.end > e.start);
  const out: DerivedBusyDay[] = [];
  for (const iso of dates) {
    const c: CivilDate | null = parseIsoDate(iso);
    if (!c) continue;
    const lo = zonedToUtc(c.y, c.m, c.d, sh, sm, opts.timeZone);
    const hi = zonedToUtc(c.y, c.m, c.d, eh, em, opts.timeZone);
    if (hi <= lo) continue;
    const windowMinutes = Math.round((hi - lo) / 60_000);
    const hits = real.filter((e) => e.end > lo && e.start < hi).map((e) => [e.start, e.end] as const);
    const busyMinutes = Math.min(windowMinutes, Math.round(unionLengthMs(hits, lo, hi) / 60_000));
    out.push({ date: iso, busyMinutes, minutesAvailable: windowMinutes - busyMinutes, busy: busyMinutes >= minBusy });
  }
  return out;
}
