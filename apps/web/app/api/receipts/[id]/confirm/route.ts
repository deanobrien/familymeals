import { NextResponse } from 'next/server';
import { apiError, badRequest, householdFromBody, isObj, readJsonBody, withApi } from '../../../../../lib/server/api/handle';
import type { LineDecision } from '../../../../../lib/receipts/types';
import { confirmReceiptDecisions } from '../../../../../lib/server/receipts/service';
import { identityOf, isReceiptId } from '../../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Strictly shape the client's decisions; anything else is a 400 (the pipeline then validates ids against the receipt). */
function parseDecisions(raw: unknown): LineDecision[] | null {
  if (!Array.isArray(raw) || raw.length > 500) return null;
  const out: LineDecision[] = [];
  for (const d of raw) {
    if (!isObj(d) || typeof d.lineId !== 'string' || (d.outcome !== 'purchase' && d.outcome !== 'extra')) return null;
    if (d.shoppingListItemId !== undefined && typeof d.shoppingListItemId !== 'string') return null;
    if (d.quantityValue !== undefined && typeof d.quantityValue !== 'number') return null;
    if (d.addToPantry !== undefined && typeof d.addToPantry !== 'boolean') return null;
    out.push({
      lineId: d.lineId,
      outcome: d.outcome,
      ...(d.shoppingListItemId !== undefined ? { shoppingListItemId: d.shoppingListItemId } : {}),
      ...(d.quantityValue !== undefined ? { quantityValue: d.quantityValue } : {}),
      ...(d.addToPantry !== undefined ? { addToPantry: d.addToPantry } : {}),
    });
  }
  return out;
}

/**
 * POST { householdId, decisions: LineDecision[] }: exactly the web confirm action. Only the lines the user explicitly
 * decided are recorded; a second confirm is refused with 409 (the receipt is already history).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readJsonBody(req);
  return withApi(req, { householdId: householdFromBody(body), write: true }, async (ctx) => {
    const decisions = parseDecisions(body?.decisions);
    if (!decisions) return badRequest('Send the lines you confirmed as decisions.');
    if (!isReceiptId(id)) return apiError(404, 'NOT_FOUND', 'Receipt not found.');
    const r = await confirmReceiptDecisions(id, decisions, identityOf(ctx));
    if (r.ok) return NextResponse.json(r);
    if (r.code === 'NOT_FOUND') return apiError(404, 'NOT_FOUND', r.error);
    if (r.code === 'ALREADY_RECONCILED') return apiError(409, 'ALREADY_RECONCILED', r.error);
    if (r.code === 'INVALID_DECISION') return apiError(422, 'REFUSED', r.error);
    return apiError(500, 'INTERNAL', r.error, {}, true);
  });
}
