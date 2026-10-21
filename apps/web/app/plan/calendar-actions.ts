'use server';

import { revalidatePath } from 'next/cache';
import { webCookingCaller } from '../../lib/server/cooking/web-caller';
import {
  calendarStatus, refreshIcsFeed, removeIcsFeed, saveIcsFeed, setManualBusy,
} from '../../lib/server/calendar/service';
import {
  addBatch, freezeBatch, markPlannedEaten, removeBatch, takePortions,
} from '../../lib/server/leftovers/service';
import { loadPlanServices } from '../../lib/server/plan/services';
import type { CalendarResult, CalendarStatus } from '../../lib/calendar/types';
import type { LeftoverResult } from '../../lib/leftovers/types';

/**
 * Calendar-aware planning and leftovers (P2-C, D410-D419): thin wrappers over lib/server/calendar and lib/server/leftovers, the
 * same modules the Android app reaches through /api/calendar and /api/leftovers. The household and user always come from the
 * server-resolved session, never the form. The ICS address is accepted here and NEVER returned.
 */

const refresh = (): void => {
  revalidatePath('/plan');
  revalidatePath('/pantry');
};

export async function setBusyAction(date: string, busy: boolean): Promise<CalendarResult> {
  const r = await setManualBusy(await webCookingCaller(), date, busy);
  if (r.ok) refresh();
  return r;
}

export async function calendarStatusAction(): Promise<CalendarResult<{ status: CalendarStatus }>> {
  return calendarStatus(await webCookingCaller());
}

export async function saveIcsAction(url: string, timeZone: string): Promise<CalendarResult<{ busyDays: number }>> {
  const r = await saveIcsFeed(await webCookingCaller(), url, timeZone);
  if (r.ok) refresh();
  return r;
}

export async function refreshIcsAction(timeZone: string, onlyIfStale = false): Promise<CalendarResult<{ busyDays: number }>> {
  const r = await refreshIcsFeed(await webCookingCaller(), timeZone, { onlyIfStale });
  if (r.ok && r.busyDays >= 0) refresh();
  return r;
}

export async function removeIcsAction(): Promise<CalendarResult> {
  const r = await removeIcsFeed(await webCookingCaller());
  if (r.ok) refresh();
  return r;
}

export async function addBatchAction(input: { title: string; portions: number; storedIn: 'fridge' | 'freezer'; today?: string }): Promise<LeftoverResult> {
  const r = await addBatch(await webCookingCaller(), input);
  if (r.ok) refresh();
  return r.ok ? { ok: true } : r;
}

export async function takePortionsAction(batchId: string, portions: number, kind: 'eaten' | 'discarded', key?: string): Promise<LeftoverResult<{ portionsLeft: number }>> {
  const r = await takePortions(await webCookingCaller(), batchId, portions, kind, key);
  if (r.ok) refresh();
  return r;
}

export async function freezeBatchAction(batchId: string, today?: string): Promise<LeftoverResult> {
  const r = await freezeBatch(await webCookingCaller(), batchId, today);
  if (r.ok) refresh();
  return r.ok ? { ok: true } : r;
}

export async function removeBatchAction(batchId: string): Promise<LeftoverResult> {
  const r = await removeBatch(await webCookingCaller(), batchId);
  if (r.ok) refresh();
  return r;
}

export async function markEatenAction(planId: string, date: string, mealType: string): Promise<LeftoverResult<{ applied: boolean; portionsLeft: number }>> {
  const caller = await webCookingCaller();
  const svc = await loadPlanServices(caller.householdId);
  const r = await markPlannedEaten(caller, svc.plans, planId, date, mealType);
  if (r.ok) refresh();
  return r;
}
