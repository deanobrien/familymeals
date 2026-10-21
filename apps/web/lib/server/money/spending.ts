// Spending view (P2-B, D404-D406): weekly budget vs planned estimate vs actual spend. Pure given its ports, so the same
// code runs in mock mode, on Supabase and in unit tests; the web page and the Android JSON route both call it.
import {
  addDays, buildMonths, buildShopResolver, buildWeeks, categoryBreakdown, effectiveLinks, londonDateOf, mondayOf, retailerKey, shopBreakdown, spendCsv,
  suggestStore, UNCATEGORISED, weekStartsBetween, type PlannedWeek, type SpendRecord,
} from '@fr/engine/money';
import type { ReceiptRecord } from '../../receipts/types';
import { AISLES } from '../../shopping/types';
import type { ManualSpend, SpendInput, SpendingView, SpendRowView, StoreRef, UnlinkedRetailer } from '../../money/types';
import { receiptSpendDate } from '../receipts/ports';
import type { MoneyRepository } from './repository';

export const DEFAULT_WEEKS = 12;
export const MAX_WEEKS = 52;

export interface SpendingDeps {
  repo: MoneyRepository;
  receipts: { reconciledBetween(householdId: string, from: string, to: string): Promise<ReceiptRecord[]> };
  stores(householdId: string): Promise<StoreRef[]>;
  /** Approved plans only (drafts are not a plan the household committed to). */
  plannedWeeks(householdId: string, from: string, to: string): Promise<PlannedWeek[]>;
  weeklyBudgetPence(householdId: string): Promise<number | null>;
  /** Aisle category of a receipt line description, or undefined when it cannot be told (never guessed). */
  categoryOf(description: string): string | undefined;
  now(): Date;
}

export interface SpendingQuery { weeks?: number }

const CATEGORY_CHOICES: string[] = [...AISLES];

/** The receipt as a spend record: printed total (else the sum of its lines), split by what each line was. */
export function receiptRecord(r: ReceiptRecord, label: string | null, categoryOf: (d: string) => string | undefined): SpendRecord | null {
  const date = receiptSpendDate(r);
  const total = r.totalPence ?? r.computedPence;
  if (!date || !(total > 0)) return null;
  const splits = r.lines
    .filter((l) => (l.netPence ?? 0) > 0)
    .map((l) => ({ category: categoryOf(l.description) ?? UNCATEGORISED, pence: l.netPence ?? 0 }));
  return { id: r.id, source: 'receipt', date, shop: label, totalPence: total, splits };
}
export function createSpendingService(deps: SpendingDeps) {
  async function load(householdId: string, weeks: number) {
    const today = londonDateOf(deps.now()) ?? deps.now().toISOString().slice(0, 10);
    const lastMonday = mondayOf(today);
    const from = addDays(lastMonday, -7 * (weeks - 1));
    const to = addDays(lastMonday, 6);
    const [stores, links, manual, receipts, planned, budget] = await Promise.all([
      deps.stores(householdId), deps.repo.links(householdId), deps.repo.listSpend(householdId, from, to),
      deps.receipts.reconciledBetween(householdId, from, to), deps.plannedWeeks(householdId, from, to), deps.weeklyBudgetPence(householdId),
    ]);
    return { today, lastMonday, from, to, stores, links, manual, receipts, planned, budget };
  }

  async function records(householdId: string, weeks: number) {
    const d = await load(householdId, weeks);
    const resolve = buildShopResolver(d.stores, d.links);
    const storeName = new Map(d.stores.map((s) => [s.id, s.name]));
    let usedScanDate = 0;
    const recs: SpendRecord[] = [];
    const rows = new Map<string, SpendRowView>();
    for (const r of d.receipts) {
      const shop = resolve(r.retailer);
      const rec = receiptRecord(r, shop?.label ?? (r.retailer?.trim() || null), deps.categoryOf);
      if (!rec) continue;
      if (!r.date) usedScanDate++;
      recs.push(rec);
      rows.set(rec.id, { id: rec.id, source: 'receipt', date: rec.date, shop: rec.shop, totalPence: rec.totalPence, note: null, category: null, retailer: r.retailer ?? null, linked: !!shop?.linked });
    }
    for (const m of d.manual) {
      const shop = (m.storeId && storeName.get(m.storeId)) || m.retailer || null;
      recs.push({ id: m.id, source: 'manual', date: m.date, shop, totalPence: m.amountPence, splits: [{ category: m.category ?? UNCATEGORISED, pence: m.amountPence }], note: m.note });
      rows.set(m.id, { id: m.id, source: 'manual', date: m.date, shop, totalPence: m.amountPence, note: m.note, category: m.category, retailer: m.retailer, linked: !!m.storeId });
    }
    return { d, recs, rows, usedScanDate, resolve };
  }

  return {
    async spending(householdId: string, q: SpendingQuery = {}): Promise<SpendingView> {
      const weeks = Math.min(MAX_WEEKS, Math.max(1, Math.floor(q.weeks ?? DEFAULT_WEEKS)));
      const { d, recs, rows, usedScanDate } = await records(householdId, weeks);
      const weekStarts = weekStartsBetween(d.from, d.to);
      const weekRows = buildWeeks({ records: recs, planned: d.planned, budgetPence: d.budget, weekStarts, today: d.today });
      const planned = weekRows.filter((w) => w.plannedPence !== null);

      const unlinked = new Map<string, UnlinkedRetailer>();
      const linkOf = effectiveLinks(d.stores, d.links);
      for (const r of d.receipts) {
        const key = retailerKey(r.retailer);
        if (!key || linkOf[key]) continue;
        const cur = unlinked.get(key);
        if (cur) cur.receipts++;
        else {
          const s = suggestStore(r.retailer, d.stores);
          unlinked.set(key, { retailer: (r.retailer ?? '').trim().slice(0, 80), key, receipts: 1, suggestion: s ? { id: s.id, name: s.name, chain: s.chain ?? null } : null });
        }
      }

      const notes = [
        'Planned figures are estimates from your recipe costs for the approved plan; spend figures are what you actually paid (confirmed receipts plus entries you added).',
        'The weekly budget shown is your current setting, applied to every week.',
        'Months are made of whole weeks (Monday to Sunday) and count in the month each week starts in.',
      ];
      if (d.stores.length === 0) notes.push('Add your shops in Settings, Stores, then link receipts to them to see spend per shop.');
      return {
        today: d.today, from: d.from, to: d.to, weeklyBudgetPence: d.budget,
        weeks: weekRows, months: buildMonths(weekRows),
        categories: categoryBreakdown(recs, d.from, d.to), shops: shopBreakdown(recs, d.from, d.to),
        recent: [...rows.values()].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)).slice(0, 40),
        totals: {
          actualPence: weekRows.reduce((t, w) => t + w.actualPence, 0), receiptsPence: weekRows.reduce((t, w) => t + w.receiptsPence, 0),
          manualPence: weekRows.reduce((t, w) => t + w.manualPence, 0),
          plannedPence: planned.length ? planned.reduce((t, w) => t + (w.plannedPence ?? 0), 0) : null,
          plannedPartial: weekRows.some((w) => w.plannedPartial), plannedWeeks: planned.length,
        },
        thisWeek: weekRows.find((w) => w.inProgress) ?? null,
        unlinked: [...unlinked.values()].sort((a, b) => b.receipts - a.receipts || a.retailer.localeCompare(b.retailer)),
        stores: d.stores, categoryChoices: CATEGORY_CHOICES, usedScanDate, notes,
      };
    },

    async csv(householdId: string, q: SpendingQuery & { from?: string; to?: string } = {}): Promise<string> {
      const weeks = Math.min(MAX_WEEKS, Math.max(1, Math.floor(q.weeks ?? MAX_WEEKS)));
      const { d, recs } = await records(householdId, weeks);
      return spendCsv(recs, q.from ?? d.from, q.to ?? d.to);
    },

    addSpend: (householdId: string, input: SpendInput): Promise<ManualSpend> => deps.repo.addSpend(householdId, input),
    updateSpend: (householdId: string, id: string, input: SpendInput): Promise<ManualSpend> => deps.repo.updateSpend(householdId, id, input),
    deleteSpend: (householdId: string, id: string): Promise<void> => deps.repo.deleteSpend(householdId, id),

    /** Is this receipt's retailer text one of the household's stores yet? A suggestion (never applied) when it is not. */
    async retailerStatus(householdId: string, retailer: string | undefined): Promise<{ linked: StoreRef | null; suggestion: StoreRef | null; stores: StoreRef[] }> {
      const [stores, links] = await Promise.all([deps.stores(householdId), deps.repo.links(householdId)]);
      const id = effectiveLinks(stores, links)[retailerKey(retailer)];
      const linked = stores.find((s) => s.id === id) ?? null;
      const s = linked ? null : suggestStore(retailer, stores);
      return { linked, suggestion: s ? { id: s.id, name: s.name, chain: s.chain ?? null } : null, stores };
    },

    /** The user confirmed "receipts that say <retailer> are this store" (or removed the link with storeId = null). */
    async linkRetailer(householdId: string, retailer: string, storeId: string | null): Promise<void> {
      await deps.repo.setLink(householdId, retailerKey(retailer), storeId);
    },
  };
}

export type SpendingService = ReturnType<typeof createSpendingService>;
