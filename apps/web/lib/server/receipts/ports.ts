import type { OutstandingItem, PriceObservation, PurchaseEvent, Quantity } from '../../receipts/matcher';
import type { ReceiptListEntry, ReceiptRecord } from '../../receipts/types';

/** Where the receipt record and its history live. TODO(L1): Supabase receipts / receipt_lines tables. */
export interface ReceiptRepository {
  list(householdId: string): Promise<ReceiptListEntry[]>;
  get(householdId: string, id: string): Promise<ReceiptRecord | undefined>;
  save(receipt: ReceiptRecord): Promise<void>;
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
