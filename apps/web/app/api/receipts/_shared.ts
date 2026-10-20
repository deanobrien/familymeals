import { imageStoreFor } from '../../../lib/server/images';
import type { PipelineIdentity } from '../../../lib/server/receipts/service';
import type { ApiCtx } from '../../../lib/server/api/handle';

/** The verified caller (withApi narrowed the household to a real membership) plus the caller's own image store (D345). */
export const identityOf = (ctx: ApiCtx): PipelineIdentity => ({ householdId: ctx.householdId, userId: ctx.userId, images: imageStoreFor(ctx.auth) });

/** Receipt ids are UUIDs (the demo seed id is a readable slug); anything else is a plain 404 before it reaches a store. */
export const isReceiptId = (id: string): boolean => /^[0-9A-Za-z-]{1,100}$/.test(id);
