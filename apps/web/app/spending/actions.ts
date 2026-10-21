'use server';

import { revalidatePath } from 'next/cache';
import type { ListCompareView, PriceHistoryView, SpendingView } from '../../lib/money/types';
import { getAppContext } from '../../lib/server/context';
import { getPriceService, getSpendingService } from '../../lib/server/money/deps';
import { runPriceAction, runSpendingAction } from '../../lib/server/money/handlers';

export type MoneyActionResult = { ok: true } | { ok: false; error: string };

async function write(run: (householdId: string) => ReturnType<typeof runSpendingAction>, paths: string[]): Promise<MoneyActionResult> {
  const ctx = await getAppContext(); // outside try: lets the auth redirect through
  if (ctx.readOnly) return { ok: false, error: 'This household is read-only while it is pending deletion.' };
  try {
    const r = await run(ctx.householdId);
    if (!r.ok) return { ok: false, error: r.error };
    for (const p of paths) revalidatePath(p);
    return { ok: true };
  } catch {
    return { ok: false, error: 'Something went wrong. Please try again.' };
  }
}

export async function addSpendAction(input: { date: string; amountPence: number; storeId?: string | null; retailer?: string | null; category?: string | null; note?: string | null }): Promise<MoneyActionResult> {
  return write((h) => runSpendingAction(h, { action: 'add', ...input }), ['/spending']);
}

export async function deleteSpendAction(id: string): Promise<MoneyActionResult> {
  return write((h) => runSpendingAction(h, { action: 'delete', id: String(id).slice(0, 80) }), ['/spending']);
}

export async function linkRetailerAction(retailer: string, storeId: string | null): Promise<MoneyActionResult> {
  return write((h) => runSpendingAction(h, { action: 'link', retailer: String(retailer).slice(0, 80), storeId }), ['/spending', '/shopping']);
}

export async function addPriceAction(input: { ingredientId: string; storeId?: string | null; retailer?: string | null; pricePence: number; packValue: number; packUnit: string; observedOn?: string }): Promise<MoneyActionResult> {
  return write((h) => runPriceAction(h, { action: 'add', ...input }), ['/spending', '/shopping']);
}

/** The Spending page data (also used to refresh after a change without a full reload). */
export async function getSpendingAction(weeks?: number): Promise<SpendingView | null> {
  try {
    const ctx = await getAppContext();
    return await getSpendingService().spending(ctx.householdId, typeof weeks === 'number' ? { weeks } : {});
  } catch {
    return null;
  }
}

/** Home / shopping widgets: this week at a glance (null when it cannot be loaded). */
export async function getSpendingWidgetAction(): Promise<Pick<SpendingView, 'thisWeek' | 'weeklyBudgetPence' | 'today'> | null> {
  try {
    const ctx = await getAppContext();
    const v = await getSpendingService().spending(ctx.householdId, { weeks: 1 });
    return { thisWeek: v.thisWeek, weeklyBudgetPence: v.weeklyBudgetPence, today: v.today };
  } catch {
    return null;
  }
}

/** Shopping page: cheapest-at badges and per-shop totals for the active list (recomputed when the list changes). */
export async function getListComparisonAction(): Promise<ListCompareView | null> {
  try {
    const ctx = await getAppContext();
    return await getPriceService().listComparison(ctx.householdId);
  } catch {
    return null;
  }
}

export async function getPriceHistoryAction(ingredientId: string): Promise<PriceHistoryView | null> {
  try {
    const ctx = await getAppContext();
    return await getPriceService().history(ctx.householdId, String(ingredientId).slice(0, 80));
  } catch {
    return null;
  }
}
