'use server';

import * as h from '../../lib/server/plan/handlers';
import { getAppContext } from '../../lib/server/context';
import { getPlanServicesFor } from '../../lib/server/plan/services';
import type { ActionResult, PlanDoc, ProposeResult } from '../../lib/plan/types';

/** Planner services for the signed-in household (never a client-supplied household id). */
async function services() {
  return getPlanServicesFor((await getAppContext()).householdId);
}

export async function savePlanAction(doc: PlanDoc): Promise<ActionResult<PlanDoc>> {
  return h.savePlan(await services(), doc);
}
export async function approvePlanAction(doc: PlanDoc): Promise<ActionResult<PlanDoc>> {
  return h.approvePlan(await services(), doc);
}
export async function proposePlanAction(prompt: string, weekStart: string): Promise<ProposeResult> {
  return h.proposePlan(await services(), prompt, weekStart);
}
export async function generateShoppingAction(planId: string): Promise<ActionResult<h.ShoppingHandoff>> {
  const ctx = await getAppContext();
  if (ctx.readOnly) return { ok: false, message: 'This household is read-only while it is pending deletion.' };
  return h.generateShopping(getPlanServicesFor(ctx.householdId), planId, ctx.userId);
}
export async function loadWeekAction(weekStart: string): Promise<PlanDoc | null> {
  return h.loadPlanForWeek(await services(), weekStart);
}
