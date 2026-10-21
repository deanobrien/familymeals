import { describe, expect, it } from 'vitest';
import { deriveBusyDays, parseIcs, zonedToUtc } from '../../src/calendar/index';

const LON = 'Europe/London';
const lines = (...l: string[]): string => l.join('\r\n') + '\r\n';
const cal = (...events: string[][]): string => lines('BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//EN', ...events.flat(), 'END:VCALENDAR');
const vevent = (...props: string[]): string[] => ['BEGIN:VEVENT', ...props, 'END:VEVENT'];
const range = (from: string, to: string) => ({ rangeStart: Date.parse(`${from}T00:00:00Z`), rangeEnd: Date.parse(`${to}T00:00:00Z`), defaultTimeZone: LON });
const parse = (text: string, from = '2026-10-19', to = '2026-10-26') => parseIcs(text, range(from, to));
const local = (y: number, m: number, d: number, hh: number, mm: number) => zonedToUtc(y, m, d, hh, mm, LON);

describe('parseIcs: single events', () => {
  it('reads UTC, TZID and floating times', () => {
    const text = cal(
      vevent('UID:a', 'DTSTART:20261021T170000Z', 'DTEND:20261021T180000Z'),
      vevent('UID:b', 'DTSTART;TZID=Europe/London:20261022T183000', 'DTEND;TZID=Europe/London:20261022T193000'),
      vevent('UID:c', 'DTSTART:20261023T180000', 'DTEND:20261023T190000'),
    );
    const { events, skipped } = parse(text);
    expect(skipped).toBe(0);
    expect(events.map((e) => [new Date(e.start).toISOString(), new Date(e.end).toISOString()])).toEqual([
      ['2026-10-21T17:00:00.000Z', '2026-10-21T18:00:00.000Z'],
      ['2026-10-22T17:30:00.000Z', '2026-10-22T18:30:00.000Z'], // BST: 18:30 local = 17:30Z
      ['2026-10-23T17:00:00.000Z', '2026-10-23T18:00:00.000Z'], // floating -> default zone (London, BST)
    ]);
  });

  it('flags all-day events and gives them their length', () => {
    const { events } = parse(cal(vevent('UID:d', 'DTSTART;VALUE=DATE:20261021', 'DTEND;VALUE=DATE:20261023')));
    expect(events).toHaveLength(1);
    expect(events[0]!.allDay).toBe(true);
    expect(events[0]!.end - events[0]!.start).toBe(2 * 86_400_000);
  });

  it('uses DURATION when there is no DTEND', () => {
    const { events } = parse(cal(vevent('UID:e', 'DTSTART:20261021T170000Z', 'DURATION:PT1H30M')));
    expect(events[0]!.end - events[0]!.start).toBe(90 * 60_000);
  });

  it('skips cancelled events and marks transparent / free ones as not busy', () => {
    const text = cal(
      vevent('UID:x', 'DTSTART:20261021T170000Z', 'DTEND:20261021T180000Z', 'STATUS:CANCELLED'),
      vevent('UID:y', 'DTSTART:20261021T170000Z', 'DTEND:20261021T180000Z', 'TRANSP:TRANSPARENT'),
      vevent('UID:z', 'DTSTART:20261021T170000Z', 'DTEND:20261021T180000Z', 'X-MICROSOFT-CDO-BUSYSTATUS:FREE'),
      vevent('UID:w', 'DTSTART:20261021T170000Z', 'DTEND:20261021T180000Z', 'X-MICROSOFT-CDO-BUSYSTATUS:OOF'),
    );
    const { events } = parse(text);
    expect(events.map((e) => e.busy)).toEqual([false, false, true]);
  });

  it('unfolds long lines and survives LF-only endings', () => {
    const text = 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:long\nDTSTART:2026102\n 1T170000Z\nDTEND:20261021T180000Z\nEND:VEVENT\nEND:VCALENDAR\n';
    expect(parse(text).events).toHaveLength(1);
  });

  it('maps Outlook (Windows) zone names and falls back to the default for unknown ones', () => {
    const text = cal(
      vevent('UID:o1', 'DTSTART;TZID=GMT Standard Time:20261021T180000', 'DTEND;TZID=GMT Standard Time:20261021T190000'),
      vevent('UID:o2', 'DTSTART;TZID=Nowhere Standard Time:20261022T180000', 'DTEND;TZID=Nowhere Standard Time:20261022T190000'),
    );
    const { events } = parse(text);
    expect(events[0]!.start).toBe(local(2026, 10, 21, 18, 0));
    expect(events[1]!.start).toBe(local(2026, 10, 22, 18, 0));
  });

  it('drops events outside the range and counts unreadable ones', () => {
    const text = cal(
      vevent('UID:in', 'DTSTART:20261021T170000Z', 'DTEND:20261021T180000Z'),
      vevent('UID:out', 'DTSTART:20270101T170000Z', 'DTEND:20270101T180000Z'),
      vevent('UID:bad', 'DTSTART:garbage', 'DTEND:20261021T180000Z'),
      vevent('UID:nostart', 'DTEND:20261021T180000Z'),
    );
    const r = parse(text);
    expect(r.events).toHaveLength(1);
    expect(r.skipped).toBe(2);
  });

  it('never throws on junk and rejects oversized input', () => {
    expect(parse('').events).toEqual([]);
    expect(parse('not a calendar at all').events).toEqual([]);
    expect(parse('BEGIN:VEVENT\nDTSTART:').events).toEqual([]);
    expect(parse('x'.repeat(5 * 1024 * 1024)).events).toEqual([]);
  });
});

describe('parseIcs: privacy', () => {
  it('has no title, place or attendee in its output', () => {
    const text = cal(vevent('UID:p', 'SUMMARY:Oncology appointment', 'LOCATION:Royal Infirmary', 'ATTENDEE;CN=Dr Jones:mailto:jones@example.org', 'DESCRIPTION:Bring results', 'DTSTART:20261021T170000Z', 'DTEND:20261021T180000Z'));
    const { events } = parse(text);
    expect(JSON.stringify(events)).not.toMatch(/oncology|infirmary|jones|results/i);
    expect(Object.keys(events[0]!).sort()).toEqual(['allDay', 'busy', 'end', 'start']);
  });
});

describe('parseIcs: recurrence', () => {
  it('expands a weekly BYDAY rule and keeps the local time across DST (clocks back 25 Oct)', () => {
    const text = cal(vevent('UID:w', 'DTSTART;TZID=Europe/London:20261019T180000', 'DTEND;TZID=Europe/London:20261019T190000', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE'));
    const { events } = parse(text, '2026-10-19', '2026-11-03');
    const starts = events.map((e) => e.start);
    expect(starts).toEqual([
      local(2026, 10, 19, 18, 0), local(2026, 10, 21, 18, 0), local(2026, 10, 26, 18, 0), local(2026, 10, 28, 18, 0), local(2026, 11, 2, 18, 0),
    ]);
    // After the clocks go back the same 18:00 local is one hour later in UTC.
    expect(new Date(starts[1]!).toISOString()).toBe('2026-10-21T17:00:00.000Z');
    expect(new Date(starts[2]!).toISOString()).toBe('2026-10-26T18:00:00.000Z');
  });

  it('honours COUNT, UNTIL and INTERVAL', () => {
    const count = cal(vevent('UID:c', 'DTSTART:20261019T170000Z', 'DTEND:20261019T180000Z', 'RRULE:FREQ=DAILY;COUNT=3'));
    expect(parse(count).events).toHaveLength(3);
    const until = cal(vevent('UID:u', 'DTSTART:20261019T170000Z', 'DTEND:20261019T180000Z', 'RRULE:FREQ=DAILY;UNTIL=20261021T235959Z'));
    expect(parse(until).events).toHaveLength(3);
    const every2 = cal(vevent('UID:i', 'DTSTART:20261019T170000Z', 'DTEND:20261019T180000Z', 'RRULE:FREQ=DAILY;INTERVAL=2'));
    expect(parse(every2).events.map((e) => new Date(e.start).getUTCDate())).toEqual([19, 21, 23, 25]);
  });

  it('counts COUNT from the series start even when the range starts later', () => {
    const text = cal(vevent('UID:late', 'DTSTART:20261012T170000Z', 'DTEND:20261012T180000Z', 'RRULE:FREQ=DAILY;COUNT=10'));
    // Occurrences: 12..21 Oct. Range 19-26 Oct sees 19, 20, 21.
    expect(parse(text).events.map((e) => new Date(e.start).getUTCDate())).toEqual([19, 20, 21]);
  });

  it('applies EXDATE and RECURRENCE-ID overrides', () => {
    const text = cal(
      vevent('UID:s', 'DTSTART:20261019T170000Z', 'DTEND:20261019T180000Z', 'RRULE:FREQ=DAILY;COUNT=4', 'EXDATE:20261020T170000Z'),
      vevent('UID:t', 'DTSTART:20261019T170000Z', 'DTEND:20261019T180000Z', 'RRULE:FREQ=DAILY;COUNT=3'),
      // moved instance of t: 20 Oct 17:00 -> 20 Oct 19:00
      vevent('UID:t', 'RECURRENCE-ID:20261020T170000Z', 'DTSTART:20261020T190000Z', 'DTEND:20261020T200000Z'),
    );
    const s = parse(text).events;
    const days = s.map((e) => `${new Date(e.start).getUTCDate()}@${new Date(e.start).getUTCHours()}`).sort();
    // series s: 19, 21, 22 (20th excluded); series t: 19, 21 + the moved 20th at 19:00
    expect(days).toEqual(['19@17', '19@17', '20@19', '21@17', '21@17', '22@17']);
  });

  it('expands MONTHLY on the nth weekday and on a month day', () => {
    const second = cal(vevent('UID:m', 'DTSTART:20261013T170000Z', 'DTEND:20261013T180000Z', 'RRULE:FREQ=MONTHLY;BYDAY=2TU'));
    const nov = parse(second, '2026-11-01', '2026-12-01').events;
    expect(nov.map((e) => new Date(e.start).getUTCDate())).toEqual([10]);
    const day = cal(vevent('UID:md', 'DTSTART:20261031T170000Z', 'DTEND:20261031T180000Z', 'RRULE:FREQ=MONTHLY'));
    // 31st does not exist in November: skipped, never moved
    expect(parse(day, '2026-11-01', '2027-01-01').events.map((e) => new Date(e.start).toISOString().slice(0, 10))).toEqual(['2026-12-31']);
  });

  it('expands a yearly rule and caps runaway rules', () => {
    const y = cal(vevent('UID:y', 'DTSTART:20241021T170000Z', 'DTEND:20241021T180000Z', 'RRULE:FREQ=YEARLY'));
    expect(parse(y).events).toHaveLength(1);
    const forever = cal(vevent('UID:f', 'DTSTART:20000101T170000Z', 'DTEND:20000101T180000Z', 'RRULE:FREQ=DAILY'));
    const t0 = Date.now();
    parse(forever);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('ignores a rule it cannot read and keeps the first instance', () => {
    const text = cal(vevent('UID:r', 'DTSTART:20261021T170000Z', 'DTEND:20261021T180000Z', 'RRULE:FREQ=HOURLY'));
    expect(parse(text).events).toHaveLength(1);
  });
});

describe('parseIcs + deriveBusyDays together', () => {
  it('a Google-style week: two busy evenings, one free, a birthday that does not count', () => {
    const text = cal(
      vevent('UID:1', 'DTSTART;TZID=Europe/London:20261020T180000', 'DTEND;TZID=Europe/London:20261020T200000'),
      vevent('UID:2', 'DTSTART;TZID=Europe/London:20261022T170000', 'DTEND;TZID=Europe/London:20261022T180000', 'RRULE:FREQ=DAILY;COUNT=1'),
      vevent('UID:3', 'DTSTART;VALUE=DATE:20261021', 'DTEND;VALUE=DATE:20261022'),
      vevent('UID:4', 'DTSTART;TZID=Europe/London:20261021T190000', 'DTEND;TZID=Europe/London:20261021T193000'),
    );
    const r = parse(text);
    const days = deriveBusyDays(r.events, ['2026-10-20', '2026-10-21', '2026-10-22'], { timeZone: LON });
    expect(days.map((d) => [d.date, d.busy, d.minutesAvailable])).toEqual([
      ['2026-10-20', true, 60],
      ['2026-10-21', false, 150],
      ['2026-10-22', true, 120],
    ]);
  });
});
