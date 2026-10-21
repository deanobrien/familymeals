'use server';

import { revalidatePath } from 'next/cache';
import { requireHouseholdContext } from '../../lib/server/auth/household-context';
import * as goals from '../../lib/server/goals/service';
import type { GoalsCaller, GoalsResult } from '../../lib/server/goals/service';

/**
 * Settings > Health goals (P3-B, D430-D439). Thin wrappers over lib/server/goals/service, the same module the Android app
 * reaches through POST /api/goals. The household and user always come from the server-resolved session, never the form.
 * Health-related data: own rows only, consent first, never sent to an AI provider.
 */
async function caller(): Promise<GoalsCaller> {
  const ctx = await requireHouseholdContext();
  return { householdId: ctx.household.id, userId: ctx.user.id, client: ctx.mode === 'supabase' ? ctx.supabase : null, readOnly: ctx.readOnly };
}

function done(r: GoalsResult): GoalsResult {
  if (r.ok) for (const p of ['/settings', '/plan']) revalidatePath(p);
  return r;
}

export async function loadGoalsAction(): Promise<GoalsResult> {
  return goals.loadGoals(await caller());
}

export async function saveGoalsAction(values: { consent: boolean; adultConfirmed: boolean; goals: string[]; portionShare: number; nudgePlan: boolean }): Promise<GoalsResult> {
  return done(await goals.saveGoals(await caller(), values));
}

export async function withdrawGoalsAction(): Promise<GoalsResult> {
  return done(await goals.withdrawGoals(await caller()));
}
