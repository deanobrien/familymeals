'use server';

import { revalidatePath } from 'next/cache';
import type { RestockBannerData, RestockResult, RestockSettings, RestockView, SetParInput } from '../../restock/types';
import { getAppContext } from '../context';
import { getRestockService } from './deps';

const GENERIC: RestockResult = { ok: false, error: 'Something went wrong. Please try again.' };
const READ_ONLY: RestockResult = { ok: false, error: 'This household is read-only while it is pending deletion.' };

async function mutate(run: (hh: string, actor: string) => Promise<RestockResult>): Promise<RestockResult> {
  const ctx = await getAppContext(); // outside try: lets the auth redirect through
  if (ctx.readOnly) return READ_ONLY;
  try {
    const res = await run(ctx.householdId, ctx.userId);
    if (res.ok) { revalidatePath('/pantry'); revalidatePath('/shopping'); }
    return res;
  } catch {
    return GENERIC;
  }
}

export async function getRestockViewAction(): Promise<RestockView | null> {
  try {
    const ctx = await getAppContext();
    return await getRestockService(ctx.householdId).getView(ctx.householdId);
  } catch {
    return null;
  }
}

export async function getRestockBannerAction(): Promise<RestockBannerData | null> {
  try {
    const ctx = await getAppContext();
    return await getRestockService(ctx.householdId).getBanner(ctx.householdId);
  } catch {
    return null;
  }
}

export async function setParAction(input: SetParInput): Promise<RestockResult> {
  return mutate((hh) => getRestockService(hh).setPar(hh, input));
}
export async function removeParAction(parId: string): Promise<RestockResult> {
  return mutate((hh) => getRestockService(hh).removePar(hh, String(parId)));
}
export async function snoozeRestockAction(parId: string, days?: number): Promise<RestockResult> {
  return mutate((hh) => getRestockService(hh).snooze(hh, String(parId), days));
}
/** Add the given suggestions (par ids), or every below-minimum suggestion when none are given, to the shopping list. */
export async function addRestockToListAction(parIds?: string[]): Promise<RestockResult> {
  return mutate((hh, actor) => getRestockService(hh).addToList(hh, actor, Array.isArray(parIds) ? parIds.map(String).slice(0, 300) : undefined));
}
export async function updateRestockSettingsAction(settings: RestockSettings): Promise<RestockResult> {
  return mutate(async (hh, actor) => {
    const svc = getRestockService(hh);
    const res = await svc.updateSettings(hh, settings);
    if (res.ok && settings.autoAdd) await svc.autoAdd(hh, actor); // turning it on catches up straight away
    return res;
  });
}
