// iCalendar (RFC 5545) reader for busy / free (P2-C, D412). It reads ONLY the properties needed to know WHEN someone is
// busy: DTSTART, DTEND, DURATION, RRULE, EXDATE, RECURRENCE-ID, UID, STATUS, TRANSP and Outlook's busy-status. It never
// reads or keeps SUMMARY, DESCRIPTION, LOCATION, ORGANIZER or ATTENDEE, so event titles cannot leak from this module.
// Pure: input text in, `CalendarEvent[]` out. Recurrence is expanded in the event's own time zone (a weekly 18:00 meeting
// stays at 18:00 across DST). Supported RRULE: FREQ DAILY / WEEKLY / MONTHLY / YEARLY, INTERVAL, COUNT, UNTIL, BYDAY (with
// ordinals for MONTHLY), BYMONTHDAY. Anything else is expanded conservatively (treated as its FREQ without the extra part).
import type { CalendarEvent } from './busy';
import { addCivilDays, isValidTimeZone, isoWeekday, zonedToUtc, type CivilDate } from './tz';

export interface IcsOptions {
  /** Instants (epoch ms) the caller cares about; events outside are dropped. */
  rangeStart: number;
  rangeEnd: number;
  /** Zone for floating times (no Z, no TZID). */
  defaultTimeZone: string;
}

export interface IcsResult {
  events: CalendarEvent[];
  /** VEVENT blocks that could not be understood (bad dates etc.). Counts only, no content. */
  skipped: number;
}

const MAX_BYTES = 4 * 1024 * 1024;
/** Generated candidates per series (counted from the series start, so a daily event from 2000 still reaches today). */
const MAX_CANDIDATES_PER_EVENT = 20000;
const MAX_EVENTS = 20000;

/** Outlook / Windows zone names -> IANA (the common ones; an unknown name falls back to the calendar's default zone). */
const WINDOWS_ZONES: Record<string, string> = {
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Romance Standard Time': 'Europe/Paris',
  'Central European Standard Time': 'Europe/Warsaw',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'GTB Standard Time': 'Europe/Bucharest',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
  'India Standard Time': 'Asia/Kolkata',
  'China Standard Time': 'Asia/Shanghai',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'UTC': 'UTC',
};

interface Prop { name: string; params: Record<string, string>; value: string }

function unfold(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function parseLine(line: string): Prop | null {
  const colon = findValueColon(line);
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [rawName, ...rawParams] = splitUnquoted(head, ';');
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: (rawName ?? '').toUpperCase(), params, value };
}

function findValueColon(line: string): number {
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ':' && !inQuote) return i;
  }
  return -1;
}

function splitUnquoted(s: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  for (const ch of s) {
    if (ch === '"') inQuote = !inQuote;
    if (ch === sep && !inQuote) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** A calendar time as written: either a date (all-day) or a wall-clock time in a zone ('UTC' for ...Z). */
interface Anchor { allDay: boolean; civil: CivilDate; hh: number; mm: number; ss: number; tz: string }

function resolveZone(name: string | undefined, fallback: string): string {
  if (!name) return fallback;
  if (isValidTimeZone(name)) return name;
  const mapped = WINDOWS_ZONES[name];
  if (mapped && isValidTimeZone(mapped)) return mapped;
  return fallback;
}

function parseAnchor(p: Prop, calendarZone: string): Anchor | null {
  const v = p.value.trim();
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (m) return { allDay: true, civil: { y: +m[1]!, m: +m[2]!, d: +m[3]! }, hh: 0, mm: 0, ss: 0, tz: 'UTC' };
  m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (!m) return null;
  const civil = { y: +m[1]!, m: +m[2]!, d: +m[3]! };
  if (civil.m < 1 || civil.m > 12 || civil.d < 1 || civil.d > 31) return null;
  const tz = m[7] === 'Z' ? 'UTC' : resolveZone(p.params.TZID, calendarZone);
  return { allDay: false, civil, hh: +m[4]!, mm: +m[5]!, ss: +m[6]!, tz };
}

const anchorMs = (a: Anchor, civil: CivilDate = a.civil): number => zonedToUtc(civil.y, civil.m, civil.d, a.hh, a.mm, a.tz, a.ss);

function parseDuration(v: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return null;
  const ms = ((+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * 86400 + +(m[4] ?? 0) * 3600 + +(m[5] ?? 0) * 60 + +(m[6] ?? 0)) * 1000;
  return m[1] === '-' ? -ms : ms;
}

interface Rule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  count?: number;
  until?: number;
  byDay: { ord: number; wd: number }[];
  byMonthDay: number[];
}

const WD: Record<string, number> = { MO: 0, TU: 1, WE: 2, TH: 3, FR: 4, SA: 5, SU: 6 };

function parseRule(value: string, calendarZone: string): Rule | null {
  const parts: Record<string, string> = {};
  for (const kv of value.split(';')) {
    const eq = kv.indexOf('=');
    if (eq > 0) parts[kv.slice(0, eq).toUpperCase()] = kv.slice(eq + 1);
  }
  const freq = parts.FREQ;
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') return null;
  const rule: Rule = { freq, interval: Math.max(1, Number(parts.INTERVAL) || 1), byDay: [], byMonthDay: [] };
  if (parts.COUNT && Number(parts.COUNT) > 0) rule.count = Math.min(MAX_CANDIDATES_PER_EVENT, Number(parts.COUNT));
  if (parts.UNTIL) {
    const a = parseAnchor({ name: 'UNTIL', params: {}, value: parts.UNTIL }, calendarZone);
    if (a) rule.until = a.allDay ? zonedToUtc(a.civil.y, a.civil.m, a.civil.d, 23, 59, 'UTC', 59) : anchorMs(a);
  }
  for (const d of (parts.BYDAY ?? '').split(',').filter(Boolean)) {
    const m = /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/.exec(d.trim());
    if (m) rule.byDay.push({ ord: m[1] ? Number(m[1]) : 0, wd: WD[m[2]!]! });
  }
  for (const d of (parts.BYMONTHDAY ?? '').split(',').filter(Boolean)) {
    const n = Number(d);
    if (Number.isInteger(n) && n >= -31 && n <= 31 && n !== 0) rule.byMonthDay.push(n);
  }
  return rule;
}

const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Local dates of the occurrences, in order, starting at the anchor's own date. Lazy: the caller stops when past its range. */
function* occurrenceDates(a: Anchor, rule: Rule): Generator<CivilDate> {
  const start = a.civil;
  const startWd = isoWeekday(start);
  if (rule.freq === 'DAILY') {
    for (let i = 0; ; i += rule.interval) yield addCivilDays(start, i);
  } else if (rule.freq === 'WEEKLY') {
    const wds = rule.byDay.length ? [...new Set(rule.byDay.map((b) => b.wd))].sort((x, y) => x - y) : [startWd];
    const weekStart = addCivilDays(start, -startWd);
    for (let w = 0; ; w += rule.interval) {
      for (const wd of wds) {
        const c = addCivilDays(weekStart, w * 7 + wd);
        if (w === 0 && wd < startWd) continue;
        yield c;
      }
    }
  } else if (rule.freq === 'MONTHLY') {
    for (let mi = 0; ; mi += rule.interval) {
      const idx = start.y * 12 + (start.m - 1) + mi;
      const y = Math.floor(idx / 12);
      const m = (idx % 12) + 1;
      const dim = daysInMonth(y, m);
      const days = new Set<number>();
      if (rule.byDay.length) {
        for (const b of rule.byDay) {
          const all: number[] = [];
          for (let d = 1; d <= dim; d++) if (isoWeekday({ y, m, d }) === b.wd) all.push(d);
          if (b.ord === 0) all.forEach((d) => days.add(d));
          else {
            const pick = b.ord > 0 ? all[b.ord - 1] : all[all.length + b.ord];
            if (pick) days.add(pick);
          }
        }
      } else if (rule.byMonthDay.length) {
        for (const n of rule.byMonthDay) {
          const d = n > 0 ? n : dim + n + 1;
          if (d >= 1 && d <= dim) days.add(d);
        }
      } else if (start.d <= dim) days.add(start.d);
      for (const d of [...days].sort((x, y) => x - y)) {
        const c = { y, m, d };
        if (mi === 0 && d < start.d) continue;
        yield c;
      }
    }
  } else {
    for (let yi = 0; ; yi += rule.interval) {
      const y = start.y + yi;
      if (start.d <= daysInMonth(y, start.m)) yield { y, m: start.m, d: start.d };
    }
  }
}

interface RawEvent { props: Prop[] }

/**
 * Parse an iCalendar feed into busy intervals within the range. Never throws on bad input: unreadable events are counted in
 * `skipped`. Titles and attendees are never read (see the module comment).
 */
export function parseIcs(text: string, opts: IcsOptions): IcsResult {
  const empty: IcsResult = { events: [], skipped: 0 };
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_BYTES) return empty;
  const lines = unfold(text);
  const raws: RawEvent[] = [];
  let calendarZone = isValidTimeZone(opts.defaultTimeZone) ? opts.defaultTimeZone : 'UTC';
  let cur: RawEvent | null = null;
  let depth = 0; // VALARM etc. nested inside a VEVENT
  for (const line of lines) {
    if (!line) continue;
    const upper = line.slice(0, 16).toUpperCase();
    if (upper.startsWith('BEGIN:VEVENT')) { cur = { props: [] }; depth = 0; continue; }
    if (upper.startsWith('END:VEVENT')) { if (cur) raws.push(cur); cur = null; if (raws.length >= MAX_EVENTS) break; continue; }
    if (cur) {
      if (upper.startsWith('BEGIN:')) { depth++; continue; }
      if (upper.startsWith('END:')) { depth = Math.max(0, depth - 1); continue; }
      if (depth > 0) continue;
      const p = parseLine(line);
      if (p && KEEP.has(p.name)) cur.props.push(p);
    } else if (upper.startsWith('X-WR-TIMEZONE')) {
      const p = parseLine(line);
      if (p) calendarZone = resolveZone(p.value.trim(), calendarZone);
    }
  }

  const events: CalendarEvent[] = [];
  let skipped = 0;
  // Overridden instances of a recurring event: `${uid}|${original start ms}`.
  const overridden = new Set<string>();
  const parsed: { raw: RawEvent; uid: string; start: Anchor; recurrenceId?: Anchor }[] = [];
  for (const raw of raws) {
    const get = (n: string): Prop | undefined => raw.props.find((p) => p.name === n);
    const dt = get('DTSTART');
    const start = dt ? parseAnchor(dt, calendarZone) : null;
    if (!start) { skipped++; continue; }
    const rid = get('RECURRENCE-ID');
    const ridAnchor = rid ? parseAnchor(rid, calendarZone) : null;
    const uid = get('UID')?.value ?? '';
    if (ridAnchor && uid) overridden.add(`${uid}|${anchorMs(ridAnchor)}`);
    parsed.push({ raw, uid, start, ...(ridAnchor ? { recurrenceId: ridAnchor } : {}) });
  }

  for (const { raw, uid, start } of parsed) {
    const get = (n: string): Prop | undefined => raw.props.find((p) => p.name === n);
    const status = get('STATUS')?.value.trim().toUpperCase();
    if (status === 'CANCELLED') continue;
    const transp = get('TRANSP')?.value.trim().toUpperCase();
    const ms = get('X-MICROSOFT-CDO-BUSYSTATUS')?.value.trim().toUpperCase();
    const busy = transp !== 'TRANSPARENT' && ms !== 'FREE';

    const s0 = anchorMs(start);
    let duration: number;
    const dtEnd = get('DTEND');
    const dur = get('DURATION');
    if (dtEnd) {
      const e = parseAnchor(dtEnd, calendarZone);
      if (!e) { skipped++; continue; }
      duration = anchorMs(e) - s0;
    } else if (dur) {
      const d = parseDuration(dur.value);
      if (d === null) { skipped++; continue; }
      duration = d;
    } else duration = start.allDay ? 86_400_000 : 0;
    if (duration <= 0 && !start.allDay) continue; // an instant is not a block of busy time
    if (duration <= 0) duration = 86_400_000;

    const emit = (startMs: number): void => {
      if (uid && overridden.has(`${uid}|${startMs}`) && !raw.props.some((p) => p.name === 'RECURRENCE-ID')) return;
      const endMs = startMs + duration;
      if (endMs > opts.rangeStart && startMs < opts.rangeEnd) events.push({ start: startMs, end: endMs, allDay: start.allDay, busy });
    };

    const rrule = get('RRULE');
    const rule = rrule ? parseRule(rrule.value, calendarZone) : null;
    if (!rule) { emit(s0); continue; }

    const excluded = new Set<number>();
    for (const ex of raw.props.filter((p) => p.name === 'EXDATE')) {
      for (const piece of ex.value.split(',')) {
        const a = parseAnchor({ ...ex, value: piece }, calendarZone);
        if (a) excluded.add(anchorMs(a));
      }
    }
    let n = 0;
    let generated = 0;
    const lowDay = Math.floor(opts.rangeStart / 86_400_000) - 2;
    const highDay = Math.floor(opts.rangeEnd / 86_400_000) + 2;
    for (const civil of occurrenceDates(start, rule)) {
      if (++generated > MAX_CANDIDATES_PER_EVENT) break;
      n++;
      if (rule.count !== undefined && n > rule.count) break;
      const dayNum = Date.UTC(civil.y, civil.m - 1, civil.d) / 86_400_000;
      if (dayNum < lowDay) continue; // far before the range: counted, never converted
      if (dayNum > highDay) break;
      const startMs = anchorMs(start, civil);
      if (startMs < s0) continue;
      if (rule.until !== undefined && startMs > rule.until) break;
      if (startMs >= opts.rangeEnd) break;
      if (!excluded.has(startMs)) emit(startMs);
    }
  }
  return { events, skipped };
}

const KEEP = new Set(['DTSTART', 'DTEND', 'DURATION', 'RRULE', 'EXDATE', 'RECURRENCE-ID', 'UID', 'STATUS', 'TRANSP', 'X-MICROSOFT-CDO-BUSYSTATUS']);
