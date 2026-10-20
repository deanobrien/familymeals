// Client-safe types for the receipt reconciliation feature (no @fr/ai, no server code).
import type { Candidate, MatchClass, OutstandingItem, Quantity, ReceiptItemLine } from './matcher';

export type ReceiptStatus = 'needs_review' | 'reconciled';

/** A parsed receipt line plus how the matcher classified it. Matching output is a SUGGESTION only. */
export type ReceiptLineRecord = ReceiptItemLine & {
  match: { classification: MatchClass; suggestedItemId?: string; candidates: Candidate[] };
};

/** What the user decided for one line at confirm time. Only lines the user confirmed are sent. */
export interface LineDecision {
  lineId: string;
  /** 'purchase' = confirmed against a shopping-list item; 'extra' = bought but not on the list. */
  outcome: 'purchase' | 'extra';
  shoppingListItemId?: string;
  /** User-adjusted quantity value in the line's own unit (purchase only). */
  quantityValue?: number;
  /** Extra only: also add to the pantry. */
  addToPantry?: boolean;
}

export interface StoredDecision extends LineDecision {
  itemName?: string;
  /** Final quantity recorded (purchase only). */
  quantity?: Quantity;
}

export interface ReceiptRecord {
  id: string;
  householdId: string;
  retailer?: string;
  /** YYYY-MM-DD as printed on the receipt. */
  date?: string;
  /** Printed total, integer pence. */
  totalPence?: number;
  /** Sum of net line prices (after discounts), integer pence. */
  computedPence: number;
  imageName?: string;
  /** Storage paths of the kept receipt photo(s) (Supabase receipt-images bucket; absent in local mode). */
  imagePaths?: string[];
  createdAt: string;
  status: ReceiptStatus;
  lines: ReceiptLineRecord[];
  orphanDiscountPence: number;
  ignored: string[];
  warnings: string[];
  reconciliation?: {
    at: string;
    purchaseEventIds: string[];
    decisions: StoredDecision[];
  };
}

export interface ReceiptListEntry {
  id: string;
  retailer?: string;
  date?: string;
  totalPence?: number;
  status: ReceiptStatus;
  lineCount: number;
}

// ---- review model (serialisable; built on the server, rendered by the client form) ----

export interface ReviewCandidate {
  itemId: string;
  name: string;
  /** 0..1 */
  score: number;
  reasons: string[];
}

export interface ReviewLine {
  lineId: string;
  raw: string;
  description: string;
  count: number;
  packLabel?: string;
  pricePence?: number;
  discountPence: number;
  discountLines: string[];
  netPence?: number;
  classification: MatchClass;
  /** Set ONLY for confident matches: pre-selected in the UI but never auto-confirmed. */
  preselectedItemId?: string;
  candidates: ReviewCandidate[];
  defaultQuantity: { value: number; unit: string };
}

export interface ReviewModel {
  receiptId: string;
  retailer?: string;
  date?: string;
  totalPence?: number;
  computedPence: number;
  /** printed total - computed; undefined when no total was read. */
  discrepancyPence?: number;
  totalOk: boolean;
  linesMissingPrice: number;
  status: ReceiptStatus;
  lines: ReviewLine[];
  /** All items still outstanding on the shopping list (for the "pick another" dropdown). */
  items: Pick<OutstandingItem, 'shoppingListItemId' | 'name'>[];
  ignored: string[];
  warnings: string[];
}
