'use server';

import { revalidatePath } from 'next/cache';
import type { ActionResult, IngredientHit, LeftoverView, PantrySettings } from '../../pantry/types';
import { getAppContext } from '../context';
import type { ScanCommitRow, ScanPreviewLine } from '../../pantry/scan-types';
import { getCurrentHouseholdId, getPantryService } from './deps';
import { linkScannedProducts } from '../products/link';
import type { AddItemInput, CorrectItemInput, LeftoverInput } from './service';

async function mutate(run: (hh: string) => Promise<ActionResult>): Promise<ActionResult> {
  const ctx = await getAppContext(); // outside try: lets the auth redirect through
  if (ctx.readOnly) return { ok: false, error: 'This household is read-only while it is pending deletion.' };
  try {
    const res = await run(ctx.householdId);
    if (res.ok) revalidatePath('/pantry');
    return res;
  } catch {
    return { ok: false, error: 'Something went wrong. Please try again.' };
  }
}

export async function addItemAction(input: AddItemInput): Promise<ActionResult> {
  return mutate((hh) => getPantryService(hh).addItem(hh, input));
}
export async function correctItemAction(input: CorrectItemInput): Promise<ActionResult> {
  return mutate((hh) => getPantryService(hh).correctItem(hh, input));
}
export async function confirmItemAction(id: string): Promise<ActionResult> {
  return mutate((hh) => getPantryService(hh).confirmItem(hh, id));
}
export async function removeItemAction(id: string): Promise<ActionResult> {
  return mutate((hh) => getPantryService(hh).removeItem(hh, id));
}
export async function updateSettingsAction(settings: PantrySettings): Promise<ActionResult> {
  return mutate((hh) => getPantryService(hh).updateSettings(hh, settings));
}
export async function acceptAdjustmentAction(eventId: string, expiry?: string): Promise<ActionResult> {
  return mutate((hh) => getPantryService(hh).acceptAdjustment(hh, eventId, expiry));
}
export async function dismissAdjustmentAction(eventId: string): Promise<ActionResult> {
  return mutate((hh) => getPantryService(hh).dismissAdjustment(hh, eventId));
}

/** Scan review: what confirming would do. Read-only. */
export async function previewScanAction(
  rows: ScanCommitRow[],
): Promise<{ ok: true; lines: ScanPreviewLine[] } | { ok: false; error: string }> {
  try {
    const hh = await getCurrentHouseholdId();
    return await getPantryService(hh).previewScan(hh, rows);
  } catch {
    return { ok: false, error: 'Something went wrong. Please try again.' };
  }
}
/** Scan confirm: the ONLY point where a scan writes to the pantry. */
export async function confirmScanAction(rows: ScanCommitRow[]): Promise<ActionResult> {
  return mutate(async (hh) => {
    const res = await getPantryService(hh).applyScan(hh, rows);
    // Barcode rows also remember the product against the chosen ingredient (D187). Never fails the add itself.
    if (res.ok) await linkScannedProducts(hh, Array.isArray(rows) ? rows : []).catch(() => console.warn('pantry scan: product link failed'));
    return res;
  });
}

export async function searchIngredientsAction(query: string): Promise<IngredientHit[]> {
  return getPantryService(await getCurrentHouseholdId()).searchIngredients(String(query).slice(0, 60));
}

export async function planLeftoversAction(
  input: LeftoverInput,
): Promise<{ ok: true; plan: LeftoverView } | { ok: false; error: string }> {
  try {
    const hh = await getCurrentHouseholdId();
    return await getPantryService(hh).planLeftovers(hh, input);
  } catch {
    return { ok: false, error: 'Something went wrong. Please try again.' };
  }
}
