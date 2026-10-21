// Supabase ReceiptRepository (lane S2, D123): receipts + receipt_lines via save_receipt / get_receipt / list_receipts
// (SECURITY INVOKER: RLS applies). The parsed line (as reviewed) is kept in receipt_lines.parsed; the flattened columns
// (description, pack quantity, prices, match status, matched item) are what other readers and the FKs see.
import 'server-only';
import type { ReceiptLineRecord, ReceiptListEntry, ReceiptRecord } from '../../receipts/types';
import type { ReceiptRepository } from '../receipts/ports';
import { derivedUuid } from './shopping-repository';
import { SupabaseRepositoryError, callRpc, isUuid, toIso, type SupabaseClient } from './rpc';

type Row = Record<string, unknown>;
const obj = (v: unknown): Row | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : undefined);
const optNum = (v: unknown): number | undefined => (v === null || v === undefined ? undefined : Number(v));
const optStr = (v: unknown): string | undefined => (v === null || v === undefined || v === '' ? undefined : String(v));
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** DB id of a receipt line: the line id itself when it is a UUID (the pipeline issues UUIDs), else derived from it. */
export const receiptLineDbId = (receiptId: string, lineId: string): string => (isUuid(lineId) ? lineId : derivedUuid(`${receiptId}:${lineId}`, 'receipt-line'));

function packColumns(l: ReceiptLineRecord): Row {
  const q = l.packQuantity;
  if (q && (q.kind === 'exact' || q.kind === 'approximate') && typeof q.value === 'number' && Number.isFinite(q.value) && q.value >= 0 && q.unit) {
    return { kind: q.kind, value: r3(q.value), unit: q.unit, ...(q.approxLabel ? { approxLabel: q.approxLabel } : {}), originalText: q.originalText ?? '' };
  }
  return { kind: 'unparsed', originalText: (l.raw ?? '').slice(0, 300) };
}

export function receiptToRpc(r: ReceiptRecord): { p_receipt: Row; p_lines: Row[] } {
  const decisions = new Map((r.reconciliation?.decisions ?? []).map((d) => [d.lineId, d]));
  const lines = r.lines.map((l, i) => {
    const d = decisions.get(l.id);
    let matchStatus = 'unmatched';
    let matchedItemId: string | undefined;
    let matchScore: number | undefined;
    if (d?.outcome === 'purchase') { matchStatus = 'confirmed'; matchedItemId = d.shoppingListItemId; }
    else if (d?.outcome === 'extra') matchStatus = 'extra';
    else if (r.status === 'reconciled') matchStatus = 'ignored';
    else if (l.match.suggestedItemId) {
      matchStatus = 'suggested';
      matchedItemId = l.match.suggestedItemId;
      matchScore = l.match.candidates.find((c) => c.shoppingListItemId === matchedItemId)?.score;
    }
    return {
      id: receiptLineDbId(r.id, l.id), lineNo: i + 1, description: l.description, quantity: packColumns(l),
      unitPricePence: l.pricePence ?? null, lineTotalPence: l.netPence ?? null, matchStatus, matchedItemId: matchedItemId ?? null,
      matchScore: matchScore ?? null, addedToPantry: d?.outcome === 'extra' && !!d.addToPantry, parsed: l,
    };
  });
  return {
    p_receipt: {
      id: r.id, retailer: r.retailer ?? null, purchasedOn: r.date ?? null, totalPence: r.totalPence ?? null,
      ...(r.imagePaths?.length ? { imagePaths: r.imagePaths } : {}),
      status: r.status === 'reconciled' ? 'reconciled' : 'parsed', reconciledAt: r.status === 'reconciled' ? (r.reconciliation?.at ?? new Date().toISOString()) : null,
      reviewState: {
        computedPence: r.computedPence, imageName: r.imageName ?? null, createdAt: r.createdAt,
        orphanDiscountPence: r.orphanDiscountPence, ignored: r.ignored, warnings: r.warnings, reconciliation: r.reconciliation ?? null,
      },
    },
    p_lines: lines,
  };
}

function lineFromRow(row: Row): ReceiptLineRecord {
  const parsed = obj(row.parsed);
  if (parsed && typeof parsed.id === 'string') return parsed as unknown as ReceiptLineRecord;
  // A line another writer created (no parsed copy): rebuild the minimum the review screen needs; never invent a match.
  const description = String(row.description ?? '');
  return {
    id: String(row.id), raw: String(row.original_text || description), tokens: [], description, count: 1,
    discountPence: 0, discountLines: [],
    ...(optNum(row.unit_price_pence) !== undefined ? { pricePence: optNum(row.unit_price_pence)! } : {}),
    ...(optNum(row.line_total_pence) !== undefined ? { netPence: optNum(row.line_total_pence)! } : {}),
    match: { classification: 'none', candidates: [] },
  } as ReceiptLineRecord;
}

export function receiptFromRpc(householdId: string, bundle: Row | null): ReceiptRecord | undefined {
  const r = obj(bundle?.receipt);
  if (!r) return undefined;
  const review = obj(r.review_state) ?? {};
  const reconciliation = obj(review.reconciliation) as ReceiptRecord['reconciliation'] | undefined;
  return {
    id: String(r.id), householdId,
    ...(optStr(r.retailer) ? { retailer: String(r.retailer) } : {}),
    ...(optStr(r.purchased_on) ? { date: String(r.purchased_on).slice(0, 10) } : {}),
    ...(optNum(r.total_pence) !== undefined ? { totalPence: optNum(r.total_pence)! } : {}),
    computedPence: Number(review.computedPence ?? 0),
    ...(optStr(review.imageName) ? { imageName: String(review.imageName) } : {}),
    ...(Array.isArray(r.image_paths) && r.image_paths.length ? { imagePaths: r.image_paths.map(String) } : {}),
    createdAt: toIso(review.createdAt ?? r.created_at),
    status: r.status === 'reconciled' ? 'reconciled' : 'needs_review',
    lines: ((bundle?.lines as Row[] | undefined) ?? []).map(lineFromRow),
    orphanDiscountPence: Number(review.orphanDiscountPence ?? 0),
    ignored: Array.isArray(review.ignored) ? review.ignored.map(String) : [],
    warnings: Array.isArray(review.warnings) ? review.warnings.map(String) : [],
    ...(reconciliation ? { reconciliation } : {}),
  };
}

export class SupabaseReceiptRepository implements ReceiptRepository {
  constructor(private readonly client: SupabaseClient, private readonly householdId: string) {}

  private check(householdId: string) {
    if (householdId !== this.householdId) throw new SupabaseRepositoryError('receipts', 'household does not match the session');
  }

  async list(householdId: string): Promise<ReceiptListEntry[]> {
    this.check(householdId);
    const rows = (await callRpc<Row[]>(this.client, 'list_receipts', { p_household_id: householdId })) ?? [];
    return rows.map((r) => ({
      id: String(r.id),
      ...(optStr(r.retailer) ? { retailer: String(r.retailer) } : {}),
      ...(optStr(r.purchased_on) ? { date: String(r.purchased_on).slice(0, 10) } : {}),
      ...(optNum(r.total_pence) !== undefined ? { totalPence: optNum(r.total_pence)! } : {}),
      status: r.status === 'reconciled' ? 'reconciled' : 'needs_review',
      lineCount: Number(r.line_count ?? 0),
    }));
  }

  async get(householdId: string, id: string): Promise<ReceiptRecord | undefined> {
    this.check(householdId);
    if (!isUuid(id)) return undefined;
    return receiptFromRpc(householdId, await callRpc<Row>(this.client, 'get_receipt', { p_household_id: householdId, p_receipt_id: id }));
  }

  async reconciledBetween(householdId: string, from: string, to: string): Promise<ReceiptRecord[]> {
    this.check(householdId);
    const rows = (await callRpc<Row[]>(this.client, 'household_spend_receipts', { p_household_id: householdId, p_from: from, p_to: to })) ?? [];
    return rows.map((b) => receiptFromRpc(householdId, b)).filter((r): r is ReceiptRecord => r !== undefined);
  }

  async save(receipt: ReceiptRecord): Promise<void> {
    this.check(receipt.householdId);
    if (!isUuid(receipt.id)) throw new SupabaseRepositoryError('save_receipt', 'receipt ids must be UUIDs');
    await callRpc(this.client, 'save_receipt', { p_household_id: receipt.householdId, ...receiptToRpc(receipt) });
  }
}
