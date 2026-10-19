'use server';

import { revalidatePath } from 'next/cache';
import type { ActionResult, IngredientHit, LeftoverView, PantrySettings } from '../../pantry/types';
import { getCurrentHouseholdId, getPantryService } from './deps';
import type { AddItemInput, CorrectItemInput, LeftoverInput } from './service';

async function mutate(run: (hh: string) => Promise<ActionResult>): Promise<ActionResult> {
  try {
    const res = await run(getCurrentHouseholdId());
    if (res.ok) revalidatePath('/pantry');
    return res;
  } catch {
    return { ok: false, error: 'Something went wrong. Please try again.' };
  }
}

export async function addItemAction(input: AddItemInput): Promise<ActionResult> {
  return mutate((hh) => getPantryService().addItem(hh, input));
}
export async function correctItemAction(input: CorrectItemInput): Promise<ActionResult> {
  return mutate((hh) => getPantryService().correctItem(hh, input));
}
export async function confirmItemAction(id: string): Promise<ActionResult> {
  return mutate((hh) => getPantryService().confirmItem(hh, id));
}
export async function removeItemAction(id: string): Promise<ActionResult> {
  return mutate((hh) => getPantryService().removeItem(hh, id));
}
export async function updateSettingsAction(settings: PantrySettings): Promise<ActionResult> {
  return mutate((hh) => getPantryService().updateSettings(hh, settings));
}
export async function acceptAdjustmentAction(eventId: string, expiry?: string): Promise<ActionResult> {
  return mutate((hh) => getPantryService().acceptAdjustment(hh, eventId, expiry));
}
export async function dismissAdjustmentAction(eventId: string): Promise<ActionResult> {
  return mutate((hh) => getPantryService().dismissAdjustment(hh, eventId));
}

export async function searchIngredientsAction(query: string): Promise<IngredientHit[]> {
  return getPantryService().searchIngredients(String(query).slice(0, 60));
}

export async function planLeftoversAction(
  input: LeftoverInput,
): Promise<{ ok: true; plan: LeftoverView } | { ok: false; error: string }> {
  try {
    return await getPantryService().planLeftovers(getCurrentHouseholdId(), input);
  } catch {
    return { ok: false, error: 'Something went wrong. Please try again.' };
  }
}
