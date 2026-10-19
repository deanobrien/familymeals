import type { IsoDate } from '../contract';

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
const WEEKDAYS_FROM_SUNDAY: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_MS = 86_400_000;

/** Days since 1970-01-01 (UTC). Returns NaN for malformed or non-existent dates. */
export function isoToDayNumber(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return Number.NaN;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = Date.UTC(y, mo - 1, d);
  const dt = new Date(t);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return Number.NaN;
  return Math.round(t / DAY_MS);
}

export function isValidIsoDate(s: string): boolean {
  return !Number.isNaN(isoToDayNumber(s));
}

export function dayNumberToIso(n: number): IsoDate {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(s: IsoDate, n: number): IsoDate {
  return dayNumberToIso(isoToDayNumber(s) + n);
}

/** b - a in whole days. */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return isoToDayNumber(b) - isoToDayNumber(a);
}

export function weekdayOf(s: IsoDate): Weekday {
  // 1970-01-01 was a Thursday (index 4 from Sunday).
  const n = isoToDayNumber(s);
  return WEEKDAYS_FROM_SUNDAY[(((n + 4) % 7) + 7) % 7]!;
}

const WEEKDAY_LABEL: Record<Weekday, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
};
export function shortDateLabel(s: IsoDate): string {
  return `${WEEKDAY_LABEL[weekdayOf(s)]} ${s}`;
}
