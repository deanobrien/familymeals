/**
 * Calendar helpers for money tracking (P2-B, D400). Household money is tracked in UK local time: a "week" is Monday to
 * Sunday as the planner already uses (`mondayOf`), and an instant (a receipt with no printed date, "today") is turned
 * into a calendar date in Europe/London, so a shop at 23:30 GMT on a Sunday stays in that week, and 00:30 BST on the
 * following Monday (= 23:30 UTC Sunday in summer) belongs to the NEW week. All arithmetic on date strings is done in UTC
 * midnight, which has no daylight-saving gaps.
 */
export const HOUSEHOLD_TIME_ZONE = 'Europe/London';

const FMT = new Intl.DateTimeFormat('en-CA', { timeZone: HOUSEHOLD_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

export const isIsoDate = (s: unknown): s is string =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** The Europe/London calendar date (YYYY-MM-DD) of an instant. An unparseable value yields undefined. */
export function londonDateOf(instant: Date | string): string | undefined {
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  if (Number.isNaN(d.getTime())) return undefined;
  const parts = FMT.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Monday (ISO week start) of the week containing `iso`. */
export function mondayOf(iso: string): string {
  const dow = (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7; // Mon = 0
  return addDays(iso, -dow);
}

/** `YYYY-MM` of a date. */
export const monthOf = (iso: string): string => iso.slice(0, 7);

/** Consecutive Monday dates from `from` to `to` inclusive (both are moved to their Monday). */
export function weekStartsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const end = mondayOf(to);
  for (let w = mondayOf(from); w <= end; w = addDays(w, 7)) out.push(w);
  return out;
}

const SHORT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
export const dateLabel = (iso: string): string => SHORT.format(new Date(`${iso}T00:00:00Z`));
export const weekLabel = (weekStart: string): string => `${dateLabel(weekStart)} to ${dateLabel(addDays(weekStart, 6))}`;
export const monthLabel = (ym: string): string => MONTH.format(new Date(`${ym}-01T00:00:00Z`));

/** "today", "yesterday", "5 days ago", "3 weeks ago", "4 months ago": how old a price is, for labels. */
export function ageLabel(days: number): string {
  const d = Math.max(0, Math.round(days));
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 14) return `${d} days ago`;
  if (d < 60) return `${Math.round(d / 7)} weeks ago`;
  if (d < 730) return `${Math.round(d / 30.4)} months ago`;
  return `${Math.round(d / 365)} years ago`;
}
