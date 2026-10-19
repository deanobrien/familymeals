'use server';

import { randomUUID } from 'node:crypto';
import { getAppContext } from '../../lib/server/context';
import { getRequirementSource } from '../../lib/server/shopping/approved-plan-source';
import { getShoppingRepository } from '../../lib/server/shopping/repository';
import { generateFromPlan, syncList } from '../../lib/server/shopping/service';
import type { SnapshotDto, SyncResponse } from '../../lib/shopping/types';

/** Replay pending commands (idempotent) and return log entries after `cursor`. Also the poll. */
export async function syncShopping(commands: unknown[], cursor: number): Promise<SyncResponse> {
  const ctx = await getAppContext();
  return syncList(getShoppingRepository(), ctx.householdId, Array.isArray(commands) ? commands : [], cursor, ctx.userId);
}

/** Full snapshot (used after a detected log gap). */
export async function snapshotShopping(): Promise<SnapshotDto> {
  return getShoppingRepository().snapshot((await getAppContext()).householdId);
}

/** Regenerate the list's plan requirements from the household's approved plan. Idempotent in effect. */
export async function generateShoppingFromPlan(
  planId: string,
): Promise<{ ok: true; planName: string; lineCount: number } | { ok: false }> {
  const ctx = await getAppContext();
  if (ctx.readOnly) return { ok: false };
  const r = await generateFromPlan(
    getShoppingRepository(), getRequirementSource(), ctx.householdId, String(planId), ctx.userId, randomUUID,
  );
  return r ? { ok: true, ...r } : { ok: false };
}
