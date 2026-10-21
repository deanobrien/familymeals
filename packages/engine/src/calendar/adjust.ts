// From busy flags to planner constraints (P2-C, D413). Pure: the orchestrator calls it with the household's stored flags.

export type BusySource = 'manual' | 'device' | 'ics';

/** One stored busy flag. `minutesAvailable` is null for a manual toggle (no number is known). */
export interface BusyDay {
  date: string;
  source: BusySource;
  minutesAvailable: number | null;
}

/** Below this many free minutes in the evening window nobody cooks: the dinner slot is skipped, not made "quick". */
export const SKIP_BELOW_MINUTES = 20;
/** Quick-meal limit used when the household has not set one. */
export const DEFAULT_QUICK_MINUTES = 30;

export interface MergedBusyDay {
  date: string;
  sources: BusySource[];
  /** The smallest known number of free minutes across sources; null = unknown (manual only). */
  minutesAvailable: number | null;
  /** true = the dinner is skipped rather than made quick. */
  skip: boolean;
}

/** One entry per date, sources combined (two calendars: the busier one wins), sorted by date. */
export function mergeBusyDays(days: readonly BusyDay[]): MergedBusyDay[] {
  const by = new Map<string, { sources: Set<BusySource>; min: number | null }>();
  for (const d of days) {
    const cur = by.get(d.date) ?? { sources: new Set<BusySource>(), min: null };
    cur.sources.add(d.source);
    if (d.minutesAvailable !== null) cur.min = cur.min === null ? d.minutesAvailable : Math.min(cur.min, d.minutesAvailable);
    by.set(d.date, cur);
  }
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date,
      sources: [...v.sources].sort(),
      minutesAvailable: v.min,
      skip: v.min !== null && v.min < SKIP_BELOW_MINUTES,
    }));
}

export interface BusyAdjustments {
  /** Dates that get the quick-meal rule. */
  quickDates: string[];
  /** Dates whose dinner is skipped. */
  skipDates: string[];
}

/** Which busy dates (restricted to `allowedDates` when given: the plan's own days) become quick meals and which become skips. */
export function busyAdjustments(days: readonly BusyDay[], allowedDates?: readonly string[]): BusyAdjustments {
  const allowed = allowedDates ? new Set(allowedDates) : null;
  const merged = mergeBusyDays(days).filter((d) => !allowed || allowed.has(d.date));
  return { quickDates: merged.filter((d) => !d.skip).map((d) => d.date), skipDates: merged.filter((d) => d.skip).map((d) => d.date) };
}

/** Wording for chips and notes: "Busy (about 45 min free)" / "Busy" / "Skip dinner (about 10 min free)". Never a title. */
export function busyLabel(d: MergedBusyDay): string {
  const free = d.minutesAvailable === null ? '' : ` (about ${d.minutesAvailable} min free)`;
  return d.skip ? `Dinner skipped${free}` : `Busy${free}`;
}
