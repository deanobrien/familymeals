'use server';

import { randomUUID } from 'node:crypto';
import { getShoppingRepository } from '../../lib/server/shopping/repository';
import { getRequirementSource } from '../../lib/server/shopping/requirement-source';
import { currentHouseholdId } from '../../lib/server/shopping/session';
import { generateFromPlan, syncList } from '../../lib/server/shopping/service';
import type { SnapshotDto, SyncResponse } from '../../lib/shopping/types';

/** Replay pending commands (idempotent) and return log entries after `cursor`. Also the poll. */
export async function syncShopping(commands: unknown[], cursor: number): Promise<SyncResponse> {
  return syncList(getShoppingRepository(), await currentHouseholdId(), Array.isArray(commands) ? commands : [], cursor);
}

/** Full snapshot (used after a detected log gap). */
export async function snapshotShopping(): Promise<SnapshotDto> {
  return getShoppingRepository().snapshot(await currentHouseholdId());
}

/** Regenerate the list's plan requirements from a plan. Idempotent in effect (matches by item key). */
export async function generateShoppingFromPlan(
  planId: string, actor: string,
): Promise<{ ok: true; planName: string; lineCount: number } | { ok: false }> {
  if (typeof actor !== 'string' || actor.length === 0 || actor.length > 64) return { ok: false };
  const r = await generateFromPlan(
    getShoppingRepository(), getRequirementSource(), await currentHouseholdId(), String(planId), actor, randomUUID,
  );
  return r ? { ok: true, ...r } : { ok: false };
}
