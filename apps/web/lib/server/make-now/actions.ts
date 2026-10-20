'use server';

import { revalidatePath } from 'next/cache';
import type { MakeNowAddResult, MakeNowView } from '../../make-now/types';
import { getAppContext } from '../context';
import { getMakeNowService } from './deps';

export async function getMakeNowAction(limit?: number): Promise<MakeNowView | null> {
  try {
    const ctx = await getAppContext();
    return await getMakeNowService(ctx.householdId).getView(ctx.householdId, typeof limit === 'number' ? { limit } : {});
  } catch {
    return null;
  }
}

export async function addMissingToListAction(recipeId: string): Promise<MakeNowAddResult> {
  const ctx = await getAppContext(); // outside try: lets the auth redirect through
  if (ctx.readOnly) return { ok: false, error: 'This household is read-only while it is pending deletion.' };
  try {
    const res = await getMakeNowService(ctx.householdId).addMissing(ctx.householdId, ctx.userId, String(recipeId).slice(0, 80));
    if (res.ok) revalidatePath('/shopping');
    return res;
  } catch {
    return { ok: false, error: 'Something went wrong. Please try again.' };
  }
}
