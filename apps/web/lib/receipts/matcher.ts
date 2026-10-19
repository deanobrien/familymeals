/**
 * Thin interface over the receipt matcher (lane L10). Everything in apps/web talks to `receiptMatcher`
 * and the re-exported types only, so swapping the vendored copy for `@fr/engine/receipt-match` is a
 * one-line change in the import below.
 */
// TODO: replace with @fr/engine/receipt-match after merge batch 2
import * as impl from './_vendor';
import type {
  Candidate,
  CandidateFlag,
  Confirmation,
  LineMatch,
  MatchClass,
  MatchOptions,
  OutstandingItem,
  ParsedReceipt,
  Pence,
  PriceObservation,
  PurchaseEvent,
  Quantity,
  ReceiptItemLine,
  ReconcileInput,
  ReconcileResult,
  TotalCheck,
} from './_vendor';

export type {
  Candidate,
  CandidateFlag,
  Confirmation,
  LineMatch,
  MatchClass,
  MatchOptions,
  OutstandingItem,
  ParsedReceipt,
  Pence,
  PriceObservation,
  PurchaseEvent,
  Quantity,
  ReceiptItemLine,
  ReconcileInput,
  ReconcileResult,
  TotalCheck,
};

export interface ReceiptMatcher {
  /** Parse OCR'd/structured receipt text lines into product lines (discounts attach to the previous item). */
  parseLines(lines: readonly string[], idPrefix?: string): ParsedReceipt;
  /** Rank candidates for every line and assign one-to-one (optimal assignment). Suggestions only. */
  match(lines: readonly ReceiptItemLine[], items: readonly OutstandingItem[], opts?: Partial<MatchOptions>): LineMatch[];
  /** Build purchase events from USER confirmations only. */
  reconcile(input: ReconcileInput): ReconcileResult;
  /** Receipt-level total check (sum of net lines vs printed total). */
  totalCheck(lines: readonly ReceiptItemLine[], receiptTotalPence: Pence | undefined, orphanDiscountPence?: Pence): TotalCheck;
  /** Default quantity for a line when confirming it. */
  suggestedQuantity(line: ReceiptItemLine): Quantity;
}

export const receiptMatcher: ReceiptMatcher = {
  parseLines: (lines, idPrefix = 'line') => impl.parseReceipt(lines, { idPrefix }),
  match: (lines, items, opts) => impl.matchReceipt(lines, items, opts),
  reconcile: (input) => impl.buildReconciliation(input),
  totalCheck: (lines, total, orphan = 0) => impl.totalCheck(lines, total, orphan),
  suggestedQuantity: (line) => impl.suggestedQuantity(line),
};

/** Scale a quantity to a user-adjusted numeric value, keeping unit and original text. */
export function withQuantityValue(q: Quantity, value: number): Quantity {
  return { ...q, kind: 'exact', value };
}

/** Convert a quantity to a comparable base (g / ml / count). */
export const toBase = impl.toBase;
