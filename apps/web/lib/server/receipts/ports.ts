import type { OutstandingItem, PriceObservation, PurchaseEvent, Quantity } from '../../receipts/matcher';
import { londonDateOf } from '@fr/engine/money';
import type { ReceiptListEntry, ReceiptRecord } from '../../receipts/types';

/** Where the receipt record and its history live (memory, or Supabase receipts / receipt_lines: D123). */
export interface ReceiptRepository {
  list(householdId: string): Promise<ReceiptListEntry[]>;
  get(householdId: string, id: string): Promise<ReceiptRecord | undefined>;
  save(receipt: ReceiptRecord): Promise<void>;
  /** Reconciled (confirmed) receipts whose spend date (printed date, else the UK scan date) is within [from, to]: P2-B spending. */
  reconciledBetween(householdId: string, from: string, to: string): Promise<ReceiptRecord[]>;
}

/** The calendar day a receipt counts as spend: the printed date, else the day it was scanned in UK time. */
export function receiptSpendDate(r: Pick<ReceiptRecord, 'date' | 'createdAt'>): string | undefined {
  return r.date ?? londonDateOf(r.createdAt);
}

/** Shopping-list items still outstanding (not yet purchased) for a household. */
export interface OutstandingItemsSource {
  list(householdId: string): Promise<OutstandingItem[]>;
}

export interface PantryEntry {
  name: string;
  quantity: Quantity;
  receiptId: string;
  receiptLineId: string;
}

/**
 * Where confirmed receipt purchases go. Append-only events; the in-memory implementation is a stand-in.
 * TODO(L1/L12): record_purchase SQL function (transactional, idempotent on PurchaseEvent.id).
 */
export interface PurchaseSink {
  recordPurchases(events: PurchaseEvent[]): Promise<void>;
  recordPriceObservations(observations: PriceObservation[]): Promise<void>;
  addToPantry(entries: PantryEntry[]): Promise<void>;
}
