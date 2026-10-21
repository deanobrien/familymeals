/**
 * Money (P2-B, D400-D409): client + defensive parsers for `/api/money/*`. The server owns every number (unit prices,
 * "cheapest at", per-shop totals, weeks in Europe/London, budget vs planned vs actual); the app renders what it gets and
 * sends intents (add or delete a spend entry, link a receipt shop to a store, add a price you saw). An unexpected shape
 * throws so a section can be left out instead of showing something wrong.
 */
import type { ServerApi } from './serverApi';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const optStr = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const optNum = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const bool = (v: unknown): boolean => v === true;

export type ActualStatus = 'no_budget' | 'over' | 'under' | 'on' | 'so_far_within' | 'no_spend';
const STATUSES: readonly string[] = ['no_budget', 'over', 'under', 'on', 'so_far_within', 'no_spend'];

export interface WeekRow {
  weekStart: string; label: string; inProgress: boolean; budgetPence: number | null; plannedPence: number | null; plannedPartial: boolean;
  actualPence: number; receiptsPence: number; manualPence: number; entries: number; actualStatus: ActualStatus; varianceToBudgetPence: number | null;
}
export interface MonthRow {
  month: string; label: string; weeks: number; budgetPence: number | null; plannedPence: number | null; plannedPartial: boolean; actualPence: number;
  actualStatus: ActualStatus; varianceToBudgetPence: number | null;
}
export interface StoreRef { id: string; name: string; chain: string | null }
export interface SpendRow { id: string; source: 'receipt' | 'manual'; date: string; shop: string | null; totalPence: number; note: string | null; category: string | null }
export interface UnlinkedRetailer { retailer: string; key: string; receipts: number; suggestion: StoreRef | null }
export interface SpendingView {
  today: string; from: string; to: string; weeklyBudgetPence: number | null;
  weeks: WeekRow[]; months: MonthRow[];
  categories: { category: string; pence: number; sharePct: number }[];
  shops: { shop: string; pence: number; trips: number }[];
  recent: SpendRow[];
  totals: { actualPence: number; receiptsPence: number; manualPence: number; plannedPence: number | null; plannedPartial: boolean; plannedWeeks: number };
  thisWeek: WeekRow | null;
  unlinked: UnlinkedRetailer[];
  stores: StoreRef[];
  categoryChoices: string[];
  usedScanDate: number;
  notes: string[];
}

const parseStore = (s: unknown): StoreRef[] => (isObj(s) && typeof s.id === 'string' && typeof s.name === 'string' ? [{ id: s.id, name: s.name, chain: optStr(s.chain) }] : []);

function parseWeek(w: unknown): WeekRow[] {
  if (!isObj(w) || typeof w.weekStart !== 'string') return [];
  return [{
    weekStart: w.weekStart, label: str(w.label, w.weekStart), inProgress: bool(w.inProgress), budgetPence: optNum(w.budgetPence), plannedPence: optNum(w.plannedPence),
    plannedPartial: bool(w.plannedPartial), actualPence: num(w.actualPence), receiptsPence: num(w.receiptsPence), manualPence: num(w.manualPence), entries: num(w.entries),
    actualStatus: STATUSES.includes(str(w.actualStatus)) ? (w.actualStatus as ActualStatus) : 'no_budget', varianceToBudgetPence: optNum(w.varianceToBudgetPence),
  }];
}

export function parseSpendingView(body: unknown): SpendingView {
  const v = isObj(body) && isObj(body.view) ? body.view : undefined;
  if (!v || typeof v.today !== 'string') throw new Error('The server returned an unexpected spending response.');
  const t = isObj(v.totals) ? v.totals : {};
  const weeks = arr(v.weeks).flatMap(parseWeek);
  return {
    today: v.today, from: str(v.from), to: str(v.to), weeklyBudgetPence: optNum(v.weeklyBudgetPence), weeks,
    months: arr(v.months).flatMap((m): MonthRow[] => isObj(m) && typeof m.month === 'string' ? [{
      month: m.month, label: str(m.label, m.month), weeks: num(m.weeks), budgetPence: optNum(m.budgetPence), plannedPence: optNum(m.plannedPence), plannedPartial: bool(m.plannedPartial),
      actualPence: num(m.actualPence), actualStatus: STATUSES.includes(str(m.actualStatus)) ? (m.actualStatus as ActualStatus) : 'no_budget', varianceToBudgetPence: optNum(m.varianceToBudgetPence),
    }] : []),
    categories: arr(v.categories).flatMap((c) => (isObj(c) && typeof c.category === 'string' ? [{ category: c.category, pence: num(c.pence), sharePct: num(c.sharePct) }] : [])),
    shops: arr(v.shops).flatMap((c) => (isObj(c) && typeof c.shop === 'string' ? [{ shop: c.shop, pence: num(c.pence), trips: num(c.trips) }] : [])),
    recent: arr(v.recent).flatMap((r): SpendRow[] => isObj(r) && typeof r.id === 'string' ? [{
      id: r.id, source: r.source === 'receipt' ? 'receipt' : 'manual', date: str(r.date), shop: optStr(r.shop), totalPence: num(r.totalPence), note: optStr(r.note), category: optStr(r.category),
    }] : []),
    totals: { actualPence: num(t.actualPence), receiptsPence: num(t.receiptsPence), manualPence: num(t.manualPence), plannedPence: optNum(t.plannedPence), plannedPartial: bool(t.plannedPartial), plannedWeeks: num(t.plannedWeeks) },
    thisWeek: arr([v.thisWeek]).flatMap(parseWeek)[0] ?? null,
    unlinked: arr(v.unlinked).flatMap((u): UnlinkedRetailer[] => isObj(u) && typeof u.retailer === 'string' ? [{
      retailer: u.retailer, key: str(u.key), receipts: num(u.receipts), suggestion: parseStore(u.suggestion)[0] ?? null,
    }] : []),
    stores: arr(v.stores).flatMap(parseStore),
    categoryChoices: arr(v.categoryChoices).filter((x): x is string => typeof x === 'string'),
    usedScanDate: num(v.usedScanDate), notes: arr(v.notes).filter((x): x is string => typeof x === 'string'),
  };
}

export const fetchSpending = async (api: ServerApi, householdId: string, weeks = 12): Promise<SpendingView> =>
  parseSpendingView(await api.get<unknown>('/api/money/spending', { householdId, weeks }));

// ---- list comparison ----
export interface ListBadge { ingredientId: string; text: string; cheapestShop: string; unitText: string; ageText: string; tied: boolean }
export interface ListCompareView {
  totalItems: number;
  shops: { label: string; linked: boolean; totalPence: number; pricedItems: number; coveragePct: number; missing: string[]; oldestText: string; allRecent: boolean }[];
  likeForLike: { itemNames: string[]; totals: { label: string; totalPence: number }[]; cheapest: string | null } | null;
  badges: Record<string, ListBadge>;
  note: string;
}

export function parseListCompare(body: unknown): ListCompareView {
  const v = isObj(body) && isObj(body.view) ? body.view : undefined;
  if (!v) throw new Error('The server returned an unexpected comparison response.');
  const badges: Record<string, ListBadge> = {};
  if (isObj(v.badges)) {
    for (const [id, b] of Object.entries(v.badges)) {
      if (isObj(b) && typeof b.text === 'string' && typeof b.ingredientId === 'string') {
        badges[id] = { ingredientId: b.ingredientId, text: b.text, cheapestShop: str(b.cheapestShop), unitText: str(b.unitText), ageText: str(b.ageText), tied: bool(b.tied) };
      }
    }
  }
  const lfl = isObj(v.likeForLike) ? v.likeForLike : null;
  return {
    totalItems: num(v.totalItems),
    shops: arr(v.shops).flatMap((s) => (isObj(s) && typeof s.label === 'string' ? [{
      label: s.label, linked: bool(s.linked), totalPence: num(s.totalPence), pricedItems: num(s.pricedItems), coveragePct: num(s.coveragePct),
      missing: arr(s.missing).filter((x): x is string => typeof x === 'string'), oldestText: str(s.oldestText), allRecent: bool(s.allRecent),
    }] : [])),
    likeForLike: lfl ? {
      itemNames: arr(lfl.itemNames).filter((x): x is string => typeof x === 'string'),
      totals: arr(lfl.totals).flatMap((t) => (isObj(t) && typeof t.label === 'string' ? [{ label: t.label, totalPence: num(t.totalPence) }] : [])),
      cheapest: optStr(lfl.cheapest),
    } : null,
    badges, note: str(v.note),
  };
}

export const fetchListCompare = async (api: ServerApi, householdId: string): Promise<ListCompareView> =>
  parseListCompare(await api.get<unknown>('/api/money/compare', { householdId }));

// ---- price history ----
export interface PriceHistoryView {
  ingredientId: string; name: string;
  comparison: {
    note: string | null; badge: string | null; savingPct: number | null; tied: boolean;
    shops: { label: string; linked: boolean; pricePence: number; packLabel: string | null; unitText: string | null; observedOn: string; ageText: string; count: number; stale: boolean; cheapest: boolean; kind: string }[];
  };
  history: { label: string; pricePence: number; packLabel: string | null; unitText: string | null; observedOn: string; ageText: string; kind: string }[];
  stores: StoreRef[];
}

export function parsePriceHistory(body: unknown): PriceHistoryView {
  const v = isObj(body) && isObj(body.view) ? body.view : undefined;
  if (!v || typeof v.ingredientId !== 'string') throw new Error('The server returned an unexpected price response.');
  const c = isObj(v.comparison) ? v.comparison : {};
  return {
    ingredientId: v.ingredientId, name: str(v.name, 'Item'),
    comparison: {
      note: optStr(c.note), badge: optStr(c.badge), savingPct: optNum(c.savingPct), tied: bool(c.tied),
      shops: arr(c.shops).flatMap((s) => (isObj(s) && typeof s.label === 'string' ? [{
        label: s.label, linked: bool(s.linked), pricePence: num(s.pricePence), packLabel: optStr(s.packLabel), unitText: optStr(s.unitText), observedOn: str(s.observedOn),
        ageText: str(s.ageText), count: num(s.count), stale: bool(s.stale), cheapest: bool(s.cheapest), kind: str(s.kind),
      }] : [])),
    },
    history: arr(v.history).flatMap((h) => (isObj(h) && typeof h.label === 'string' ? [{
      label: h.label, pricePence: num(h.pricePence), packLabel: optStr(h.packLabel), unitText: optStr(h.unitText), observedOn: str(h.observedOn), ageText: str(h.ageText), kind: str(h.kind),
    }] : [])),
    stores: arr(v.stores).flatMap(parseStore),
  };
}

export const fetchPriceHistory = async (api: ServerApi, householdId: string, ingredientId: string): Promise<PriceHistoryView> =>
  parsePriceHistory(await api.get<unknown>('/api/money/prices', { householdId, ingredientId }));

// ---- writes (the server validates again; a refusal throws with its text) ----
async function write(api: ServerApi, path: string, body: Obj): Promise<void> {
  const r = await api.post<unknown>(path, body);
  if (!isObj(r) || r.ok !== true) throw new Error('The server returned an unexpected response.');
}

export interface SpendInput { date: string; amountPence: number; storeId?: string | null; retailer?: string | null; category?: string | null; note?: string | null }
export const addSpend = (api: ServerApi, householdId: string, i: SpendInput) => write(api, '/api/money/spending', { action: 'add', householdId, ...i });
export const deleteSpend = (api: ServerApi, householdId: string, id: string) => write(api, '/api/money/spending', { action: 'delete', householdId, id });
export const linkRetailer = (api: ServerApi, householdId: string, retailer: string, storeId: string | null) =>
  write(api, '/api/money/spending', { action: 'link', householdId, retailer, storeId });
export const addPrice = (api: ServerApi, householdId: string, i: { ingredientId: string; storeId?: string | null; retailer?: string | null; pricePence: number; packValue: number; packUnit: string }) =>
  write(api, '/api/money/prices', { action: 'add', householdId, ...i });

// ---- formatting and input helpers ----
export const gbp = (p: number): string => (p < 0 ? `-£${(-p / 100).toFixed(2)}` : `£${(p / 100).toFixed(2)}`);

/** "12.50", "£12.5", "12" -> pence; null when it is not a sensible money amount. */
export function poundsToPence(text: string): number | null {
  const m = /^\s*£?\s*(\d{1,7})(?:\.(\d{1,2}))?\s*$/.exec(text);
  if (!m) return null;
  const p = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || 0);
  return p >= 1 && p <= 100_000_000 ? p : null;
}

/** The week's status in words (same wording as the web). */
export function statusText(s: ActualStatus, variance: number | null): string {
  const m = (p: number) => `£${(Math.abs(p) / 100).toFixed(2)}`;
  switch (s) {
    case 'over': return variance === null ? 'Over budget' : `${m(variance)} over budget`;
    case 'under': return variance === null ? 'Under budget' : `${m(variance)} under budget`;
    case 'on': return 'Exactly on budget';
    case 'so_far_within': return variance === null ? 'Within budget so far' : `${m(variance)} left so far`;
    case 'no_spend': return 'No spend recorded';
    default: return 'No weekly budget set';
  }
}

export const csvPath = (weeks = 52): string => `/api/money/spending/csv?weeks=${weeks}`;
