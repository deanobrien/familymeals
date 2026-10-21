import { addDays, mondayOf, monthLabel, monthOf, weekLabel } from './time';

/**
 * Budget tracking (P2-B, D404-D406): weekly budget vs the PLANNED estimate (approved meal plan) vs ACTUAL spend (confirmed
 * receipts plus manual entries). The three are different things and are never blended: planned is an estimate from recipe
 * costs ("at least" when some ingredients are unpriced), actual is what was paid. A week the household has not finished
 * is "so far", never "under budget".
 */
export const UNCATEGORISED = 'Uncategorised';

export interface SpendSplit { category: string; pence: number }

export interface SpendRecord {
  id: string;
  source: 'receipt' | 'manual';
  /** YYYY-MM-DD in household time (the receipt's printed date, else the day it was scanned in Europe/London). */
  date: string;
  shop: string | null;
  totalPence: number;
  /** By category; need not sum to the total (the rest is "Uncategorised", see normaliseSplits). */
  splits: readonly SpendSplit[];
  note?: string | null;
}

/**
 * Splits that add up to exactly the total: same-category entries merged, the unexplained remainder (unreadable lines, bags,
 * orphan discounts) as "Uncategorised", and if the lines add up to MORE than the total (discount lines not attached to an
 * item) every split is scaled down proportionally so nothing is double counted. Integer pence, largest remainder.
 */
export function normaliseSplits(totalPence: number, splits: readonly SpendSplit[]): SpendSplit[] {
  const total = Math.max(0, Math.round(totalPence));
  const merged = new Map<string, number>();
  for (const s of splits) {
    if (!Number.isFinite(s.pence) || s.pence <= 0) continue;
    const c = s.category.trim() || UNCATEGORISED;
    merged.set(c, (merged.get(c) ?? 0) + Math.round(s.pence));
  }
  const sum = [...merged.values()].reduce((a, b) => a + b, 0);
  if (sum <= total) {
    if (sum < total) merged.set(UNCATEGORISED, (merged.get(UNCATEGORISED) ?? 0) + (total - sum));
    return [...merged.entries()].map(([category, pence]) => ({ category, pence }));
  }
  // scale down: floor each share, then hand the leftover pence to the largest fractional parts
  const entries = [...merged.entries()].map(([category, pence]) => ({ category, exact: (pence * total) / sum }));
  const out = entries.map((e) => ({ category: e.category, pence: Math.floor(e.exact), frac: e.exact - Math.floor(e.exact) }));
  let left = total - out.reduce((a, b) => a + b.pence, 0);
  for (const o of [...out].sort((a, b) => b.frac - a.frac || a.category.localeCompare(b.category))) {
    if (left <= 0) break;
    o.pence++; left--;
  }
  return out.filter((o) => o.pence > 0).map(({ category, pence }) => ({ category, pence }));
}

export interface PlannedWeek {
  weekStart: string;
  /** Estimated cost of the APPROVED plan: null when nothing could be costed. */
  pence: number | null;
  /** Some meals/ingredients were unpriced, so `pence` is a lower bound ("at least"). */
  partial: boolean;
  uncostedMeals: number;
  meals: number;
}

export type ActualStatus = 'no_budget' | 'over' | 'under' | 'on' | 'so_far_within' | 'no_spend';
export type PlannedStatus = 'none' | 'over' | 'within' | 'unknown' | 'no_budget';

export interface WeekRow {
  weekStart: string;
  label: string;
  inProgress: boolean;
  budgetPence: number | null;
  plannedPence: number | null;
  plannedPartial: boolean;
  plannedStatus: PlannedStatus;
  actualPence: number;
  receiptsPence: number;
  manualPence: number;
  entries: number;
  actualStatus: ActualStatus;
  /** actual - budget (positive = over); null with no budget. */
  varianceToBudgetPence: number | null;
  /** actual - planned estimate (positive = spent more than planned); null when there is no planned figure or it is partial. */
  varianceToPlannedPence: number | null;
}

export interface BuildWeeksInput {
  records: readonly SpendRecord[];
  planned: readonly PlannedWeek[];
  budgetPence: number | null;
  /** Mondays, oldest first. */
  weekStarts: readonly string[];
  /** Today in household time. */
  today: string;
}

export function buildWeeks(input: BuildWeeksInput): WeekRow[] {
  const plannedBy = new Map(input.planned.map((p) => [p.weekStart, p]));
  const recBy = new Map<string, SpendRecord[]>();
  for (const r of input.records) {
    const w = mondayOf(r.date);
    (recBy.get(w) ?? recBy.set(w, []).get(w)!).push(r);
  }
  return input.weekStarts.map((weekStart): WeekRow => {
    const recs = recBy.get(weekStart) ?? [];
    const receiptsPence = recs.filter((r) => r.source === 'receipt').reduce((t, r) => t + r.totalPence, 0);
    const manualPence = recs.filter((r) => r.source === 'manual').reduce((t, r) => t + r.totalPence, 0);
    const actualPence = receiptsPence + manualPence;
    const inProgress = weekStart <= input.today && input.today <= addDays(weekStart, 6);
    const p = plannedBy.get(weekStart);
    const budget = input.budgetPence;
    let plannedStatus: PlannedStatus = 'none';
    if (p && p.meals > 0) {
      if (budget === null) plannedStatus = 'no_budget';
      else if (p.pence !== null && p.pence > budget) plannedStatus = 'over'; // a lower bound already over is certainly over
      else plannedStatus = p.pence === null || p.partial ? 'unknown' : 'within';
    }
    let actualStatus: ActualStatus;
    if (budget === null) actualStatus = 'no_budget';
    else if (actualPence > budget) actualStatus = 'over';
    else if (recs.length === 0) actualStatus = 'no_spend';
    else if (inProgress) actualStatus = 'so_far_within';
    else actualStatus = actualPence === budget ? 'on' : 'under';
    return {
      weekStart, label: weekLabel(weekStart), inProgress, budgetPence: budget,
      plannedPence: p?.pence ?? null, plannedPartial: p?.partial ?? false, plannedStatus,
      actualPence, receiptsPence, manualPence, entries: recs.length, actualStatus,
      varianceToBudgetPence: budget === null ? null : actualPence - budget,
      varianceToPlannedPence: p && p.pence !== null && !p.partial ? actualPence - p.pence : null,
    };
  });
}

export interface MonthRow {
  month: string;
  label: string;
  /** Weeks (Monday to Sunday) that START in this month: months are made of whole weeks. */
  weeks: number;
  budgetPence: number | null;
  plannedPence: number | null;
  plannedPartial: boolean;
  plannedWeeks: number;
  actualPence: number;
  receiptsPence: number;
  manualPence: number;
  actualStatus: ActualStatus;
  varianceToBudgetPence: number | null;
}

/** Monthly view = the weekly rows grouped by the month each week starts in (budget, planned and actual use the same weeks). */
export function buildMonths(weeks: readonly WeekRow[]): MonthRow[] {
  const groups = new Map<string, WeekRow[]>();
  for (const w of weeks) (groups.get(monthOf(w.weekStart)) ?? groups.set(monthOf(w.weekStart), []).get(monthOf(w.weekStart))!).push(w);
  return [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([month, ws]): MonthRow => {
    const budget = ws.some((w) => w.budgetPence === null) ? null : ws.reduce((t, w) => t + (w.budgetPence ?? 0), 0);
    const planned = ws.filter((w) => w.plannedPence !== null);
    const actualPence = ws.reduce((t, w) => t + w.actualPence, 0);
    const inProgress = ws.some((w) => w.inProgress);
    const anySpend = ws.some((w) => w.entries > 0);
    let actualStatus: ActualStatus;
    if (budget === null) actualStatus = 'no_budget';
    else if (actualPence > budget) actualStatus = 'over';
    else if (!anySpend) actualStatus = 'no_spend';
    else if (inProgress) actualStatus = 'so_far_within';
    else actualStatus = actualPence === budget ? 'on' : 'under';
    return {
      month, label: monthLabel(month), weeks: ws.length, budgetPence: budget,
      plannedPence: planned.length ? planned.reduce((t, w) => t + (w.plannedPence ?? 0), 0) : null,
      plannedPartial: ws.some((w) => w.plannedPartial), plannedWeeks: planned.length,
      actualPence, receiptsPence: ws.reduce((t, w) => t + w.receiptsPence, 0), manualPence: ws.reduce((t, w) => t + w.manualPence, 0),
      actualStatus, varianceToBudgetPence: budget === null ? null : actualPence - budget,
    };
  });
}

export interface CategoryRow { category: string; pence: number; sharePct: number }

/** Spend by category between two dates inclusive, biggest first, "Uncategorised" last. Shares sum to about 100. */
export function categoryBreakdown(records: readonly SpendRecord[], from: string, to: string): CategoryRow[] {
  const by = new Map<string, number>();
  for (const r of records) {
    if (r.date < from || r.date > to) continue;
    for (const s of normaliseSplits(r.totalPence, r.splits)) by.set(s.category, (by.get(s.category) ?? 0) + s.pence);
  }
  const total = [...by.values()].reduce((a, b) => a + b, 0);
  return [...by.entries()]
    .map(([category, pence]) => ({ category, pence, sharePct: total ? Math.round((pence / total) * 1000) / 10 : 0 }))
    .sort((a, b) => (a.category === UNCATEGORISED ? 1 : 0) - (b.category === UNCATEGORISED ? 1 : 0) || b.pence - a.pence || a.category.localeCompare(b.category));
}

export interface ShopSpendRow { shop: string; pence: number; trips: number }

export function shopBreakdown(records: readonly SpendRecord[], from: string, to: string): ShopSpendRow[] {
  const by = new Map<string, ShopSpendRow>();
  for (const r of records) {
    if (r.date < from || r.date > to) continue;
    const shop = r.shop?.trim() || 'Shop not recorded';
    const cur = by.get(shop) ?? { shop, pence: 0, trips: 0 };
    cur.pence += r.totalPence; cur.trips++;
    by.set(shop, cur);
  }
  return [...by.values()].sort((a, b) => b.pence - a.pence || a.shop.localeCompare(b.shop));
}

// ---- CSV (D406) ----

/** A cell safe for spreadsheets: quoted when needed, and a leading = + - @ (formula) is defused with an apostrophe. */
export function csvCell(v: string | number): string {
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const SPEND_CSV_HEADER = ['Date', 'Week starting', 'Source', 'Shop', 'Category', 'Amount (GBP)', 'Note'] as const;

/** One row per record per category (a receipt split across categories is several rows that add up to its total). Oldest first. */
export function spendCsv(records: readonly SpendRecord[], from?: string, to?: string): string {
  const rows: string[] = [SPEND_CSV_HEADER.map(csvCell).join(',')];
  const recs = records.filter((r) => (!from || r.date >= from) && (!to || r.date <= to))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || (a.id < b.id ? -1 : 1));
  for (const r of recs) {
    const splits = normaliseSplits(r.totalPence, r.splits);
    for (const s of splits.length ? splits : [{ category: UNCATEGORISED, pence: r.totalPence }]) {
      rows.push([
        r.date, mondayOf(r.date), r.source === 'receipt' ? 'Receipt' : 'Manual entry', r.shop ?? '', s.category,
        (s.pence / 100).toFixed(2), r.note ?? '',
      ].map(csvCell).join(','));
    }
  }
  return rows.join('\r\n') + '\r\n';
}

/** "£32.40 of £80.00 so far" style helpers live in the UIs; this one keeps the wording of a week's status in one place. */
export function statusText(s: ActualStatus, variancePence: number | null): string {
  const gbp = (p: number) => `£${(Math.abs(p) / 100).toFixed(2)}`;
  switch (s) {
    case 'over': return variancePence === null ? 'Over budget' : `${gbp(variancePence)} over budget`;
    case 'under': return variancePence === null ? 'Under budget' : `${gbp(variancePence)} under budget`;
    case 'on': return 'Exactly on budget';
    case 'so_far_within': return variancePence === null ? 'Within budget so far' : `${gbp(variancePence)} left so far`;
    case 'no_spend': return 'No spend recorded';
    case 'no_budget': return 'No weekly budget set';
  }
}

