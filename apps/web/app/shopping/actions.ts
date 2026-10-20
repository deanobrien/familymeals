'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { getAppContext } from '../../lib/server/context';
import { getRequirementSource } from '../../lib/server/shopping/approved-plan-source';
import { archiveListOp, createListOp, renameListOp, switchListOp } from '../../lib/server/shopping/lists-ops';
import { getShoppingStore } from '../../lib/server/shopping/store';
import { generateFromPlan, syncList } from '../../lib/server/shopping/service';
import type { SnapshotDto, SyncResponse } from '../../lib/shopping/types';

/** Replay pending commands (idempotent) and return log entries after `cursor`. Also the poll. */
export async function syncShopping(commands: unknown[], cursor: number, listId?: string | null): Promise<SyncResponse> {
  const ctx = await getAppContext();
  const list = Array.isArray(commands) ? commands : [];
  const expected = typeof listId === 'string' && listId ? listId : null;
  if (ctx.readOnly) {
    // Pending deletion = read-only (the database refuses the writes): still catch up, and tell the client to drop
    // its queued changes instead of retrying them forever.
    const res = await syncList(getShoppingStore(), ctx.householdId, [], cursor, ctx.userId, expected);
    const ids = list.map((c) => (c && typeof c === 'object' ? (c as { commandId?: unknown }).commandId : undefined)).filter((x): x is string => typeof x === 'string');
    return { ...res, dropped: [...new Set([...res.dropped, ...ids])] };
  }
  return syncList(getShoppingStore(), ctx.householdId, list, cursor, ctx.userId, expected);
}

/** Full snapshot (used after a detected log gap). */
export async function snapshotShopping(): Promise<SnapshotDto> {
  return getShoppingStore().snapshot((await getAppContext()).householdId);
}

/** Regenerate the list's plan requirements from the household's approved plan. Idempotent in effect. */
export async function generateShoppingFromPlan(
  planId: string,
): Promise<{ ok: true; planName: string; lineCount: number } | { ok: false }> {
  const ctx = await getAppContext();
  if (ctx.readOnly) return { ok: false };
  const r = await generateFromPlan(
    getShoppingStore(), getRequirementSource(), ctx.householdId, String(planId), ctx.userId, randomUUID,
  );
  return r ? { ok: true, ...r } : { ok: false };
}

// ---- several lists, one active (SL1, DECISIONS D263) ----
type ListActionResult = { ok: true } | { ok: false; error: string };

async function listAction(run: (hh: string) => Promise<ListActionResult>): Promise<ListActionResult> {
  const ctx = await getAppContext(); // outside try: lets the auth redirect through
  if (ctx.readOnly) return { ok: false, error: 'This household is read-only while it is pending deletion.' };
  try {
    const res = await run(ctx.householdId);
    if (res.ok) revalidatePath('/shopping');
    return res;
  } catch {
    return { ok: false, error: 'Something went wrong. Please try again.' };
  }
}

/** Start a new, empty named list (it becomes the one you shop from; the previous list is kept, archived). */
export async function createShoppingListAction(name: string): Promise<ListActionResult> {
  return listAction((hh) => createListOp(getShoppingStore(), hh, name));
}

/** Make an older list the one you shop from (the current one is archived, not deleted). */
export async function switchShoppingListAction(listId: string): Promise<ListActionResult> {
  return listAction((hh) => switchListOp(getShoppingStore(), hh, listId));
}

export async function renameShoppingListAction(listId: string, name: string): Promise<ListActionResult> {
  return listAction((hh) => renameListOp(getShoppingStore(), hh, listId, name));
}

/** Put the current list away (kept whole, archived). The next item you add starts a fresh list. */
export async function archiveShoppingListAction(): Promise<ListActionResult> {
  return listAction((hh) => archiveListOp(getShoppingStore(), hh));
}
