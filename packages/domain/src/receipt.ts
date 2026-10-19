/**
 * Wire shape for a parsed receipt (AI output / fixture projection / input to the engine receipt matcher).
 *
 * Ratified 2026-10-19 (INTEGRATION-NOTES "Receipt shapes"): the canonical line is
 *   { rawText, quantity?, pricePence, discountPence (positive) }.
 * It is named `ReceiptParseLine` here because `ReceiptLine` in ./entities is the persisted receipt_lines ROW.
 * Sign convention: discounts are POSITIVE saved pence on the line they discount (never negative lines on the wire);
 * QA fixtures that carry negative discount lines map onto this shape via e2e `toCanonicalReceiptLines`.
 */
import { z } from 'zod';
import { IsoDate, Pence } from './primitives';

export const ReceiptParseLine = z.object({
  rawText: z.string().min(1),
  /** units bought; absent = 1 */
  quantity: z.number().int().positive().optional(),
  /** gross line price, pence */
  pricePence: Pence,
  /** positive saved pence applied to this line (multibuy / promo); 0 = none */
  discountPence: Pence.default(0),
  confidence: z.number().min(0).max(1).optional(),
});
export type ReceiptParseLine = z.infer<typeof ReceiptParseLine>;

export const ReceiptParse = z.object({
  retailer: z.string().min(1).max(80).nullable(),
  date: IsoDate.nullable(),
  lines: z.array(ReceiptParseLine),
  /** what was actually paid, pence */
  totalPence: Pence.nullable(),
  warnings: z.array(z.string()).default([]),
});
export type ReceiptParse = z.infer<typeof ReceiptParse>;
