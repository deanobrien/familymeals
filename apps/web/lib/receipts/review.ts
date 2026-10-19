import { receiptMatcher, type OutstandingItem, type Quantity } from './matcher';
import type { ReceiptRecord, ReviewLine, ReviewModel } from './types';

export function packLabel(q: Quantity | undefined): string | undefined {
  if (!q || q.value === undefined) return undefined;
  return `${q.value}${q.unit ? ` ${q.unit}` : ''}`;
}

/**
 * Build the serialisable review model for a receipt against the CURRENTLY outstanding list items.
 * Only `confident` matches get a pre-selected item; uncertain ones just list their candidates.
 */
export function buildReviewModel(receipt: ReceiptRecord, outstanding: readonly OutstandingItem[]): ReviewModel {
  const nameById = new Map(outstanding.map((i) => [i.shoppingListItemId, i.name]));
  const tc = receiptMatcher.totalCheck(receipt.lines, receipt.totalPence, receipt.orphanDiscountPence);

  const lines: ReviewLine[] = receipt.lines.map((l) => {
    const candidates = l.match.candidates
      .filter((c) => nameById.has(c.shoppingListItemId))
      .map((c) => ({
        itemId: c.shoppingListItemId,
        name: nameById.get(c.shoppingListItemId)!,
        score: c.score,
        reasons: c.reasons,
      }));
    const pre = l.match.classification === 'confident' ? l.match.suggestedItemId : undefined;
    const dq = receiptMatcher.suggestedQuantity(l);
    return {
      lineId: l.id,
      raw: l.raw.replace(/\s+-?£?\d+\.\d{2}\s*$/, ''), // drop the trailing price we appended
      description: l.description,
      count: l.count,
      packLabel: packLabel(l.packQuantity),
      pricePence: l.pricePence,
      discountPence: l.discountPence,
      discountLines: l.discountLines,
      netPence: l.netPence,
      classification: l.match.classification,
      preselectedItemId: pre && nameById.has(pre) ? pre : undefined,
      candidates,
      defaultQuantity: { value: dq.value ?? l.count, unit: dq.unit ?? 'item' },
    };
  });

  return {
    receiptId: receipt.id,
    retailer: receipt.retailer,
    date: receipt.date,
    totalPence: receipt.totalPence,
    computedPence: tc.computedPence,
    discrepancyPence: tc.discrepancyPence,
    totalOk: tc.ok,
    linesMissingPrice: tc.linesMissingPrice.length,
    status: receipt.status,
    lines,
    items: outstanding.map((i) => ({ shoppingListItemId: i.shoppingListItemId, name: i.name })),
    ignored: receipt.ignored,
    warnings: receipt.warnings,
  };
}
