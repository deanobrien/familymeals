import { NextResponse } from 'next/server';
import { apiError, bodyHousehold, guarded, isRecord, json, queryHousehold, readJson } from '../../../lib/server/api/bearer-route';
import { callerOf } from '../../../lib/server/cooking/api';
import { addBatch, freezeBatch, loadLeftovers, markPlannedEaten, removeBatch, takePortions } from '../../../lib/server/leftovers/service';
import { contextClient, loadBusyViews, weekEnd } from '../../../lib/server/calendar/planner';
import { loadPlanServices } from '../../../lib/server/plan/services';
import { mondayOf } from '../../../lib/plan/dates';
import { emptyDoc } from '../../../lib/plan/ops';
import type { LeftoverResult } from '../../../lib/leftovers/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUS: Record<string, number> = { read_only: 403, forbidden: 403, not_found: 404, invalid_input: 422, not_enough: 409, past_use_by: 409, already_frozen: 409, unknown: 500 };

function respond(r: LeftoverResult<object>): NextResponse {
  if (r.ok) {
    const { ok: _ok, ...rest } = r;
    return json(rest);
  }
  return apiError(STATUS[r.error] ?? 500, r.error.toUpperCase(), r.message, r.error === 'unknown');
}

/**
 * GET ?householdId=&week=YYYY-MM-DD&today= -> { leftovers: { batches, suggestions } }: the fridge / freezer inventory and, for the
 * given plan week, which batch could go in which empty slot (busy evenings first for freezer meals).
 */
export async function GET(req: Request) {
  return guarded(req, queryHousehold(req), {}, async (auth) => {
    const q = new URL(req.url).searchParams;
    const svc = await loadPlanServices(auth.householdId);
    const today = q.get('today') ?? undefined;
    const weekStart = mondayOf(q.get('week') && /^\d{4}-\d{2}-\d{2}$/.test(q.get('week')!) ? q.get('week')! : new Date().toISOString().slice(0, 10));
    const doc = (await svc.plans.getByWeek(auth.householdId, weekStart)) ?? emptyDoc(svc.newId(), auth.householdId, weekStart, ['dinner'], svc.now());
    const client = await contextClient();
    const busy = await loadBusyViews(auth.householdId, client, weekStart, weekEnd(weekStart));
    const leftovers = await loadLeftovers(callerOf(auth), { today, weekDoc: doc, plans: svc.plans, busyDates: busy.map((b) => b.date), portionsPerSlot: svc.household.defaultServings ?? 4 });
    return json({ leftovers });
  });
}

/**
 * POST { householdId?, action, ... }:
 *   add      { title, portions, storedIn }              a batch added by hand
 *   eat      { batchId, portions, key? }                ate some (key makes a retried tap one event)
 *   discard  { batchId, portions, key? }                threw some away
 *   freeze   { batchId }                                move fridge food to the freezer (in date only)
 *   remove   { batchId }                                delete a batch
 *   eaten    { planId, date, mealType }                 a planned leftover meal was eaten: takes its portions ONCE
 */
export async function POST(req: Request) {
  const body = await readJson(req);
  return guarded(req, bodyHousehold(body), { write: true }, async (auth) => {
    if (!isRecord(body)) return apiError(400, 'BAD_REQUEST', 'Send a JSON object.');
    const caller = callerOf(auth);
    const today = typeof body.today === 'string' ? body.today : undefined;
    switch (body.action) {
      case 'add': return respond(await addBatch(caller, { title: body.title, portions: body.portions, storedIn: body.storedIn, today }));
      case 'eat': return respond(await takePortions(caller, body.batchId, body.portions, 'eaten', body.key));
      case 'discard': return respond(await takePortions(caller, body.batchId, body.portions, 'discarded', body.key));
      case 'freeze': return respond(await freezeBatch(caller, body.batchId, today));
      case 'remove': return respond(await removeBatch(caller, body.batchId));
      case 'eaten': {
        const svc = await loadPlanServices(auth.householdId);
        return respond(await markPlannedEaten(caller, svc.plans, body.planId, body.date, body.mealType));
      }
      default: return apiError(400, 'BAD_REQUEST', 'Unknown action.');
    }
  });
}
