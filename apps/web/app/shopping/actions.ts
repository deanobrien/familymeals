'use server';

import { randomUUID } from 'node:crypto';
import { getAppContext } from '../../lib/server/context';
import { getRequirementSource } from '../../lib/server/shopping/approved-plan-source';
import { getShoppingStore } from '../../lib/server/shopping/store';
import { generateFromPlan, syncList } from '../../lib/server/shopping/service';
import type { SnapshotDto, SyncResponse } from '../../lib/shopping/types';

/** Replay pending commands (idempotent) and return log entries after `cursor`. Also the poll. */
export async function syncShopping(commands: unknown[], cursor: number): Promise<SyncResponse> {
  const ctx = await getAppContext();
  const list = Array.isArray(commands) ? commands : [];
  if (ctx.readOnly) {
    // Pending deletion = read-only (the database refuses the writes): still catch up, and tell the client to drop
    // its queued changes instead of retrying them forever.
    const res = await syncList(getShoppingStore(), ctx.householdId, [], cursor, ctx.userId);
    const ids = list.map((c) => (c && typeof c === 'object' ? (c as { commandId?: unknown }).commandId : undefined)).filter((x): x is string => typeof x === 'string');
    return { ...res, dropped: [...res.dropped, ...ids] };
  }
  return syncList(getShoppingStore(), ctx.householdId, list, cursor, ctx.userId);
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
