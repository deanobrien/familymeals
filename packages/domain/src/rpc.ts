/** Inputs/outputs of the SQL RPCs (migrations 0002, 0012, 0013). */
import { z } from 'zod';
import { HouseholdRole, Pence, Quantity, Uuid, IsoDateTime } from './primitives';

export const CreateInvitationInput = z.object({
  householdId: Uuid,
  email: z.email().optional(),
  role: HouseholdRole.default('member'),
  /** hours; DB caps at 30 days */
  ttlHours: z.number().int().min(1).max(720).default(168),
});
export type CreateInvitationInput = z.infer<typeof CreateInvitationInput>;
export const CreateInvitationResult = z.object({
  invitationId: Uuid,
  /** raw 64-hex token: returned once, never stored */
  token: z.string().regex(/^[0-9a-f]{64}$/),
  expiresAt: IsoDateTime,
});
export type CreateInvitationResult = z.infer<typeof CreateInvitationResult>;

export const PurchaseMode = z.enum(['tick', 'purchase']);
export type PurchaseMode = z.infer<typeof PurchaseMode>;

/** public.record_purchase(). eventId doubles as the idempotent command id. */
export const RecordPurchaseInput = z
  .object({
    eventId: Uuid,
    itemId: Uuid,
    mode: PurchaseMode,
    quantity: Quantity.optional(),
    pricePence: Pence.optional(),
    receiptLineId: Uuid.optional(),
    /** engine-computed outstanding when SQL cannot convert (density etc.), with the event count it saw */
    expectedOutstanding: z.number().nonnegative().optional(),
    expectedEventCount: z.number().int().nonnegative().optional(),
  })
  .refine((i) => i.mode === 'tick' || (i.quantity !== undefined && (i.quantity.kind === 'exact' || i.quantity.kind === 'approximate')), {
    message: "mode 'purchase' requires an exact/approximate quantity",
  })
  .refine((i) => (i.expectedOutstanding === undefined) === (i.expectedEventCount === undefined), {
    message: 'expectedOutstanding and expectedEventCount go together',
  });
export type RecordPurchaseInput = z.infer<typeof RecordPurchaseInput>;

export const PurchaseRejectReason = z.enum([
  'item_removed', 'already_complete', 'needs_engine_outstanding', 'invalid_quantity', 'invalid_price', 'already_voided',
]);
export type PurchaseRejectReason = z.infer<typeof PurchaseRejectReason>;

export const PurchaseCommandResult = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('applied'),
    eventId: Uuid,
    quantity: z.object({ kind: z.string(), value: z.number().nullable(), unit: z.string().nullable() }).optional(),
    duplicate: z.boolean().optional(),
  }),
  z.object({
    status: z.literal('rejected'),
    reason: PurchaseRejectReason,
    completedBy: z.array(Uuid).optional(),
    activeEventCount: z.number().int().optional(),
    eventId: Uuid.optional(),
    duplicate: z.boolean().optional(),
  }),
]);
export type PurchaseCommandResult = z.infer<typeof PurchaseCommandResult>;

/** Map to positional SQL args of public.record_purchase(). */
export function recordPurchaseArgs(i: RecordPurchaseInput) {
  return {
    p_event_id: i.eventId,
    p_item_id: i.itemId,
    p_mode: i.mode,
    p_qty: i.quantity ?? null,
    p_price_pence: i.pricePence ?? null,
    p_receipt_line_id: i.receiptLineId ?? null,
    p_expected_outstanding: i.expectedOutstanding ?? null,
    p_expected_event_count: i.expectedEventCount ?? null,
  };
}
