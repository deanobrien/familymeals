import type { ReceiptParse } from '@fr/ai';
import { receiptMatcher, withQuantityValue, type PriceObservation, type ReceiptItemLine } from '../../receipts/matcher';
import { buildReviewModel } from '../../receipts/review';
import type { LineDecision, ReceiptLineRecord, ReceiptRecord, ReviewModel, StoredDecision } from '../../receipts/types';
import type { OutstandingItemsSource, PurchaseSink, ReceiptRepository } from './ports';

/** The slice of the AI provider the pipeline needs (the real/mock `AiProvider` satisfies it). */
export interface ReceiptParser {
  parseReceipt(image: Uint8Array): Promise<ReceiptParse>;
}

export interface PipelineDeps {
  householdId: string;
  /** Acting user, recorded as PurchaseEvent.createdBy. */
  userId: string;
  /** Validate/normalise the upload (magic-byte check, EXIF rotate, resize). Throws on bad images. */
  prepareImage(bytes: Uint8Array): Promise<Uint8Array>;
  parser: ReceiptParser;
  outstanding: OutstandingItemsSource;
  receipts: ReceiptRepository;
  purchases: PurchaseSink;
  newId(): string;
  now(): Date;
}

export class ReceiptError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'ALREADY_RECONCILED' | 'INVALID_DECISION',
    message: string,
  ) {
    super(message);
    this.name = 'ReceiptError';
  }
}

const poundsText = (pence: number) => `${Math.floor(Math.abs(pence) / 100)}.${String(Math.abs(pence) % 100).padStart(2, '0')}`;

/**
 * Turn the AI's structured lines into till-style text lines for the matcher's parser. Negative prices are
 * discounts (attached to the previous item); a quantity above 1 becomes an "N X" prefix.
 */
export function toTillLines(parse: ReceiptParse): string[] {
  return parse.lines.map((l) => {
    const text = l.text.trim();
    if (l.pricePence < 0) return `${text} -${poundsText(l.pricePence)}`;
    const qty = l.qty && l.qty > 1 && Number.isInteger(l.qty) ? `${l.qty} X ` : '';
    return `${qty}${text} ${poundsText(l.pricePence)}`;
  });
}

/**
 * Upload pipeline: prepareImage -> parseReceipt (AI) -> parse lines -> rank candidates + optimal assignment
 * -> persisted receipt record (status needs_review). Creates NO purchases: matching is only a suggestion.
 */
export async function processReceiptUpload(
  deps: PipelineDeps,
  input: { bytes: Uint8Array; imageName?: string },
): Promise<ReceiptRecord> {
  const image = await deps.prepareImage(input.bytes);
  const parse = await deps.parser.parseReceipt(image);

  const parsed = receiptMatcher.parseLines(toTillLines(parse), 'line');
  const items = await deps.outstanding.list(deps.householdId);
  const matches = receiptMatcher.match(parsed.items, items);

  // Line ids become UUIDs (the contract's receiptLineId; receipt_lines.id in Supabase, D123).
  const lines: ReceiptLineRecord[] = parsed.items.map((l, i) => {
    const m = matches[i]!;
    return {
      ...l,
      id: deps.newId(),
      match: { classification: m.classification, suggestedItemId: m.suggestion?.shoppingListItemId, candidates: m.candidates },
    };
  });

  const total = parse.totalPence ?? parsed.totalPence;
  const tc = receiptMatcher.totalCheck(parsed.items, total, parsed.orphanDiscountPence);
  const warnings = [...parse.warnings];
  if (parsed.ignored.length) warnings.push(`${parsed.ignored.length} line(s) were not recognised as products and were left out.`);

  const record: ReceiptRecord = {
    id: deps.newId(),
    householdId: deps.householdId,
    retailer: parse.retailer,
    date: parse.date,
    totalPence: total,
    computedPence: tc.computedPence,
    imageName: input.imageName,
    createdAt: deps.now().toISOString(),
    status: 'needs_review',
    lines,
    orphanDiscountPence: parsed.orphanDiscountPence,
    ignored: parsed.ignored,
    warnings,
  };
  await deps.receipts.save(record);
  return record;
}

export async function loadReview(deps: PipelineDeps, receiptId: string): Promise<ReviewModel | undefined> {
  const receipt = await deps.receipts.get(deps.householdId, receiptId);
  if (!receipt) return undefined;
  const items = await deps.outstanding.list(deps.householdId);
  return buildReviewModel(receipt, items);
}

export interface ConfirmSummary {
  purchases: number;
  extras: number;
  pantryAdds: number;
  leftOutstanding: number;
}

/**
 * Confirm a receipt from explicit user decisions. Only lines the user confirmed against a list item become
 * PurchaseEvents; every other list item stays outstanding. Records actual prices as 'receipt' observations,
 * adds flagged extras to the pantry, and keeps the receipt (status -> reconciled) as history.
 */
export async function confirmReceipt(
  deps: PipelineDeps,
  receiptId: string,
  decisions: readonly LineDecision[],
): Promise<ConfirmSummary> {
  const receipt = await deps.receipts.get(deps.householdId, receiptId);
  if (!receipt) throw new ReceiptError('NOT_FOUND', 'Receipt not found.');
  if (receipt.status === 'reconciled') throw new ReceiptError('ALREADY_RECONCILED', 'This receipt has already been reconciled.');

  const items = await deps.outstanding.list(deps.householdId);
  const itemById = new Map(items.map((i) => [i.shoppingListItemId, i]));
  const lineById = new Map<string, ReceiptLineRecord>(receipt.lines.map((l) => [l.id, l]));

  const seen = new Set<string>();
  const confirmations = [];
  const stored: StoredDecision[] = [];
  const extraLines: { line: ReceiptItemLine; add: boolean }[] = [];

  for (const d of decisions) {
    const line = lineById.get(d.lineId);
    if (!line) throw new ReceiptError('INVALID_DECISION', `Unknown receipt line ${d.lineId}.`);
    if (seen.has(d.lineId)) throw new ReceiptError('INVALID_DECISION', `Receipt line ${d.lineId} was decided twice.`);
    seen.add(d.lineId);

    if (d.outcome === 'extra') {
      stored.push({ lineId: d.lineId, outcome: 'extra', addToPantry: !!d.addToPantry });
      extraLines.push({ line, add: !!d.addToPantry });
      continue;
    }
    const item = d.shoppingListItemId ? itemById.get(d.shoppingListItemId) : undefined;
    if (!item) throw new ReceiptError('INVALID_DECISION', 'That shopping item is no longer outstanding.');
    const base = receiptMatcher.suggestedQuantity(line);
    let quantity = base;
    if (d.quantityValue !== undefined) {
      if (!Number.isFinite(d.quantityValue) || d.quantityValue <= 0) {
        throw new ReceiptError('INVALID_DECISION', 'Quantity must be greater than zero.');
      }
      quantity = withQuantityValue(base, d.quantityValue);
    }
    confirmations.push({ receiptLineId: line.id, shoppingListItemId: item.shoppingListItemId, quantity });
    stored.push({ lineId: d.lineId, outcome: 'purchase', shoppingListItemId: item.shoppingListItemId, itemName: item.name, quantity });
  }

  const now = deps.now().toISOString();
  const result = receiptMatcher.reconcile({
    lines: receipt.lines,
    items,
    confirmations,
    receiptTotalPence: receipt.totalPence,
    orphanDiscountPence: receipt.orphanDiscountPence,
    createdBy: deps.userId,
    now,
    newId: deps.newId,
  });

  // Actual price history: one 'receipt' observation per confirmed line (price per pack, after discounts).
  const observedOn = receipt.date ?? now.slice(0, 10);
  const observations: PriceObservation[] = [];
  for (const ev of result.purchaseEvents) {
    const line = lineById.get(ev.receiptLineId!)!;
    if (ev.actualPricePence === undefined) continue;
    const weighed = line.weightG !== undefined;
    const packs = weighed ? 1 : Math.max(1, line.count);
    const item = itemById.get(ev.shoppingListItemId)!;
    observations.push({
      ingredientId: item.ingredientId,
      retailer: receipt.retailer,
      pricePence: Math.round(ev.actualPricePence / packs),
      packQuantity: line.packQuantity ?? { kind: 'exact', value: 1, unit: 'item', originalText: line.raw },
      kind: 'receipt',
      observedOn,
      source: `receipt:${receipt.id}:${line.id}`,
    });
  }

  // TODO(record_purchase): these three writes should be one transaction.
  await deps.purchases.recordPurchases(result.purchaseEvents);
  await deps.purchases.recordPriceObservations(observations);
  const pantry = extraLines.filter((e) => e.add).map((e) => ({
    name: e.line.description,
    quantity: receiptMatcher.suggestedQuantity(e.line),
    receiptId: receipt.id,
    receiptLineId: e.line.id,
  }));
  if (pantry.length) await deps.purchases.addToPantry(pantry);

  receipt.status = 'reconciled';
  receipt.reconciliation = { at: now, purchaseEventIds: result.purchaseEvents.map((e) => e.id), decisions: stored };
  await deps.receipts.save(receipt);

  return {
    purchases: result.purchaseEvents.length,
    extras: extraLines.length,
    pantryAdds: pantry.length,
    leftOutstanding: items.length - new Set(result.purchaseEvents.map((e) => e.shoppingListItemId)).size,
  };
}
