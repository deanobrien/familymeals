// Client-safe money types (P2-B): the view models the Spending page, the shopping panel and the Android app render.
// Nothing here imports server code. The server builds these; clients never compute prices themselves (D403).
import type { CategoryRow, IngredientComparison, MonthRow, ShopSpendRow, SpendRecord, WeekRow } from '@fr/engine/money';

export interface ManualSpend {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  amountPence: number;
  storeId: string | null;
  retailer: string | null;
  category: string | null;
  note: string | null;
}

export interface SpendInput {
  date: string;
  amountPence: number;
  storeId?: string | null;
  retailer?: string | null;
  category?: string | null;
  note?: string | null;
}

export const MAX_SPEND_PENCE = 100_000_000;

const isoDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s && s >= '2000-01-01' && s <= '2100-01-01';
const trimmed = (v: unknown, max: number): string | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validate untrusted input for a manual spend entry. Returns the clean input or an error message to show. */
export function parseSpendInput(raw: unknown): { ok: true; value: SpendInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Send the spend details.' };
  const o = raw as Record<string, unknown>;
  if (!isoDate(o.date)) return { ok: false, error: 'Choose a valid date.' };
  const pence = o.amountPence;
  if (typeof pence !== 'number' || !Number.isInteger(pence) || pence < 1 || pence > MAX_SPEND_PENCE) return { ok: false, error: 'Enter an amount above zero.' };
  const storeId = o.storeId === undefined || o.storeId === null || o.storeId === '' ? null : typeof o.storeId === 'string' && UUID.test(o.storeId) ? o.storeId : undefined;
  if (storeId === undefined) return { ok: false, error: 'That store is not valid.' };
  return {
    ok: true,
    value: {
      date: o.date, amountPence: pence, storeId,
      retailer: trimmed(o.retailer, 80) ?? null, category: trimmed(o.category, 60) ?? null, note: trimmed(o.note, 200) ?? null,
    },
  };
}

/** "12.50", "£12.5", "12" -> pence; null when it is not a sensible money amount. */
export function poundsToPence(text: string): number | null {
  const m = /^\s*£?\s*(\d{1,7})(?:\.(\d{1,2}))?\s*$/.exec(text);
  if (!m) return null;
  const p = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || 0);
  return p >= 1 && p <= MAX_SPEND_PENCE ? p : null;
}

export interface StoreRef { id: string; name: string; chain: string | null }

/** A retailer name on confirmed receipts that is not linked to a store yet, with a suggestion to confirm. */
export interface UnlinkedRetailer {
  retailer: string;
  key: string;
  receipts: number;
  suggestion: StoreRef | null;
}

export interface SpendRowView {
  id: string;
  source: 'receipt' | 'manual';
  date: string;
  shop: string | null;
  totalPence: number;
  note: string | null;
  category: string | null;
  /** The retailer text printed on the receipt (receipts only), for linking. */
  retailer: string | null;
  linked: boolean;
}

export interface SpendingView {
  /** Today in UK time, the first and last week shown. */
  today: string;
  from: string;
  to: string;
  weeklyBudgetPence: number | null;
  weeks: WeekRow[];
  months: MonthRow[];
  categories: CategoryRow[];
  shops: ShopSpendRow[];
  recent: SpendRowView[];
  /** Totals over the range shown. */
  totals: { actualPence: number; receiptsPence: number; manualPence: number; plannedPence: number | null; plannedPartial: boolean; plannedWeeks: number };
  /** The week containing today (what the Home widget shows). */
  thisWeek: WeekRow | null;
  unlinked: UnlinkedRetailer[];
  stores: StoreRef[];
  /** Aisle categories a manual entry can use (the shopping list's own labels). */
  categoryChoices: string[];
  /** True when receipt dates were missing for some receipts and the scan day was used. */
  usedScanDate: number;
  notes: string[];
}

export type { CategoryRow, IngredientComparison, MonthRow, ShopSpendRow, SpendRecord, WeekRow };

export interface ListCompareView {
  totalItems: number;
  shops: {
    label: string; storeId: string | null; linked: boolean; totalPence: number; pricedItems: number; coveragePct: number;
    missing: string[]; oldestText: string; allRecent: boolean;
  }[];
  likeForLike: { itemNames: string[]; totals: { label: string; totalPence: number }[]; cheapest: string | null } | null;
  /** list item id -> cheapest badge. */
  badges: Record<string, { ingredientId: string; text: string; cheapestShop: string; unitText: string; ageText: string; tied: boolean; otherShops: number }>;
  note: string;
}

export interface PriceHistoryView {
  ingredientId: string;
  name: string;
  comparison: {
    basis: 'kg' | 'l' | 'each' | null;
    note: string | null;
    badge: string | null;
    tied: boolean;
    savingPct: number | null;
    shops: {
      label: string; linked: boolean; pricePence: number; packLabel: string | null; unitText: string | null; observedOn: string;
      ageText: string; count: number; stale: boolean; comparable: boolean; cheapest: boolean; kind: 'receipt' | 'user_confirmed';
    }[];
  };
  history: { label: string; pricePence: number; packLabel: string | null; unitText: string | null; observedOn: string; ageText: string; kind: 'receipt' | 'user_confirmed' }[];
  stores: StoreRef[];
}
