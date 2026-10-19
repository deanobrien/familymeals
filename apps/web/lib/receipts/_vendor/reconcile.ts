// TODO: replace with @fr/engine/receipt-match after merge batch 2 (vendored copy of lane L10).
import type { IsoDateTime, Pence, PurchaseEvent, Quantity, Uuid } from './contract';
import type { OutstandingItem } from './match';
import { toBase, type ReceiptItemLine } from './normalise';

/** A decision the USER made in the review screen. Suggestions never become events without one. */
export interface Confirmation {
  receiptLineId: string;
  shoppingListItemId: Uuid;
  /** User-adjusted quantity; defaults to the line's quantity. */
  quantity?: Quantity;
  /** Override of the line price (pence). Defaults to the net line price. */
  actualPricePence?: Pence;
}

export interface ReconcileInput {
  lines: readonly ReceiptItemLine[];
  items: readonly OutstandingItem[];
  confirmations: readonly Confirmation[];
  receiptTotalPence?: Pence;
  /** Discount lines that preceded any item (positive pence saved). */
  orphanDiscountPence?: Pence;
  createdBy: Uuid;
  now: IsoDateTime;
  /** Client id generator (injected so the result is deterministic / idempotent in tests and offline replay). */
  newId: () => Uuid;
  /** Allowed |discrepancy| in pence before the total check fails. Default 0. */
  totalTolerancePence?: Pence;
}

export interface TotalCheck {
  computedPence: Pence;
  receiptTotalPence?: Pence;
  /** receiptTotal - computed (positive = receipt higher than the sum of its lines). */
  discrepancyPence?: Pence;
  ok: boolean;
  /** Lines with no price, which makes `computed` an under-count. */
  linesMissingPrice: string[];
}

export interface ReconcileResult {
  purchaseEvents: PurchaseEvent[];
  /** Receipt lines not confirmed against a list item: candidates for "extra purchase / add to pantry". */
  extras: ReceiptItemLine[];
  /** Outstanding items with no confirmed purchase: left outstanding, untouched. */
  unmatchedItems: OutstandingItem[];
  totalCheck: TotalCheck;
  warnings: string[];
}

/** Default quantity for a confirmed line. */
export function suggestedQuantity(line: ReceiptItemLine): Quantity {
  const b = toBase(line.packQuantity);
  if (line.packQuantity && line.packQuantity.value !== undefined && b && b.dim !== 'count') {
    return line.weightG !== undefined
      ? { ...line.packQuantity, originalText: line.raw }
      : { ...line.packQuantity, value: line.packQuantity.value * line.count, originalText: line.raw };
  }
  return { kind: 'exact', value: line.packQuantity?.value ? line.packQuantity.value * line.count : line.count, unit: 'item', originalText: line.raw };
}

export function totalCheck(
  lines: readonly ReceiptItemLine[], receiptTotalPence: Pence | undefined, orphanDiscountPence = 0, tolerance = 0,
): TotalCheck {
  let computed = -orphanDiscountPence;
  const missing: string[] = [];
  for (const l of lines) {
    if (l.netPence === undefined) missing.push(l.id); else computed += l.netPence;
  }
  const discrepancy = receiptTotalPence === undefined ? undefined : receiptTotalPence - computed;
  const ok = discrepancy !== undefined && Math.abs(discrepancy) <= tolerance && missing.length === 0;
  return { computedPence: computed, receiptTotalPence, discrepancyPence: discrepancy, ok, linesMissingPrice: missing };
}

/**
 * Build the proposed reconciliation from user confirmations only.
 * Rules: one receipt line -> at most one list item (first confirmation wins, later ones warned and ignored);
 * several lines may feed one item (e.g. two bottles of milk) and yield one PurchaseEvent each.
 */
export function buildReconciliation(input: ReconcileInput): ReconcileResult {
  const warnings: string[] = [];
  const lineById = new Map(input.lines.map((l) => [l.id, l]));
  const itemById = new Map(input.items.map((i) => [i.shoppingListItemId, i]));
  const confirmedLines = new Set<string>();
  const touchedItems = new Set<Uuid>();
  const events: PurchaseEvent[] = [];

  for (const c of input.confirmations) {
    const line = lineById.get(c.receiptLineId);
    const item = itemById.get(c.shoppingListItemId);
    if (!line) { warnings.push(`confirmation references unknown receipt line ${c.receiptLineId}; ignored`); continue; }
    if (!item) { warnings.push(`confirmation references unknown list item ${c.shoppingListItemId}; ignored`); continue; }
    if (confirmedLines.has(line.id)) { warnings.push(`receipt line ${line.id} already confirmed; duplicate ignored`); continue; }
    confirmedLines.add(line.id);
    touchedItems.add(item.shoppingListItemId);
    const ev: PurchaseEvent = {
      id: input.newId(),
      shoppingListItemId: item.shoppingListItemId,
      quantity: c.quantity ?? suggestedQuantity(line),
      receiptLineId: line.id,
      createdBy: input.createdBy,
      createdAt: input.now,
    };
    const price = c.actualPricePence ?? line.netPence;
    if (price !== undefined) ev.actualPricePence = price;
    events.push(ev);
  }

  const extras = input.lines.filter((l) => !confirmedLines.has(l.id));
  const unmatchedItems = input.items.filter((i) => !touchedItems.has(i.shoppingListItemId));
  const tc = totalCheck(input.lines, input.receiptTotalPence, input.orphanDiscountPence ?? 0, input.totalTolerancePence ?? 0);
  if (tc.discrepancyPence !== undefined && tc.discrepancyPence !== 0) {
    warnings.push(`receipt total differs from sum of lines by ${tc.discrepancyPence}p`);
  }
  if (input.receiptTotalPence === undefined) warnings.push('no receipt total available for checking');
  if (tc.linesMissingPrice.length) warnings.push(`lines without a price: ${tc.linesMissingPrice.join(', ')}`);
  return { purchaseEvents: events, extras, unmatchedItems, totalCheck: tc, warnings };
}
