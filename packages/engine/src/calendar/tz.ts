// Minimal, dependency-free time-zone helpers built on Intl (P2-C, D410). Wall-clock time in an IANA zone <-> epoch ms,
// DST-correct. All functions are pure; an unknown zone name throws RangeError from Intl (callers validate with isValidTimeZone).

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    formatters.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false;
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** Offset of `tz` from UTC at the instant `ms`, in ms (positive east of Greenwich). */
export function tzOffsetMs(ms: number, tz: string): number {
  if (tz === 'UTC') return 0;
  const parts = formatter(tz).formatToParts(new Date(ms));
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * The instant at which the wall clock in `tz` reads y-m-d hh:mm:ss. In a spring-forward gap the clock time does not exist:
 * the result is that time shifted forward by the gap (01:30 becomes 02:30 BST). In an autumn overlap the earlier instant wins.
 */
export function zonedToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string, ss = 0): number {
  const guess = Date.UTC(y, m - 1, d, hh, mm, ss);
  if (tz === 'UTC') return guess;
  const off1 = tzOffsetMs(guess, tz);
  const c1 = guess - off1;
  const off2 = tzOffsetMs(c1, tz);
  if (off2 === off1) return c1;
  const c2 = guess - off2;
  const ok1 = tzOffsetMs(c1, tz) === guess - c1;
  const ok2 = tzOffsetMs(c2, tz) === guess - c2;
  if (ok1 && ok2) return Math.min(c1, c2); // autumn overlap: the earlier instant
  if (ok1) return c1;
  if (ok2) return c2;
  return Math.max(c1, c2); // spring-forward gap: the wall time does not exist; shift forward by the gap
}

export interface CivilDate { y: number; m: number; d: number }

export function parseIsoDate(iso: string): CivilDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const c = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  const dt = new Date(Date.UTC(c.y, c.m - 1, c.d));
  return dt.getUTCFullYear() === c.y && dt.getUTCMonth() === c.m - 1 && dt.getUTCDate() === c.d ? c : null;
}

export const toIsoDate = (c: CivilDate): string => `${String(c.y).padStart(4, '0')}-${String(c.m).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`;

export function addCivilDays(c: CivilDate, n: number): CivilDate {
  const dt = new Date(Date.UTC(c.y, c.m - 1, c.d + n));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

/** 0 = Monday ... 6 = Sunday. */
export function isoWeekday(c: CivilDate): number {
  return (new Date(Date.UTC(c.y, c.m - 1, c.d)).getUTCDay() + 6) % 7;
}

/** The civil date (in `tz`) of the instant `ms`. */
export function civilDateOf(ms: number, tz: string): CivilDate {
  const parts = formatter(tz).formatToParts(new Date(ms));
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}
