'use server';

import * as h from '../../lib/server/plan/handlers';
import { getPlanServices } from '../../lib/server/plan/services';
import type { ActionResult, PlanDoc, ProposeResult } from '../../lib/plan/types';

export async function savePlanAction(doc: PlanDoc): Promise<ActionResult<PlanDoc>> {
  return h.savePlan(getPlanServices(), doc);
}
export async function approvePlanAction(doc: PlanDoc): Promise<ActionResult<PlanDoc>> {
  return h.approvePlan(getPlanServices(), doc);
}
export async function proposePlanAction(prompt: string, weekStart: string): Promise<ProposeResult> {
  return h.proposePlan(getPlanServices(), prompt, weekStart);
}
export async function generateShoppingAction(planId: string): Promise<ActionResult<h.ShoppingHandoff>> {
  return h.generateShopping(getPlanServices(), planId);
}
export async function loadWeekAction(weekStart: string): Promise<PlanDoc | null> {
  return h.loadPlanForWeek(getPlanServices(), weekStart);
}
