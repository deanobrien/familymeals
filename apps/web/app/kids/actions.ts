'use server';

import { revalidatePath } from 'next/cache';
import { webKidsCaller } from '../../lib/server/kids/callers';
import * as kids from '../../lib/server/kids/service';
import type { KidsResult, KidView } from '../../lib/kids/types';

/** Kids' mode (P3-A, D425-D429): thin wrappers over lib/server/kids, the module the Android app reaches through /api/kids. */

const refresh = () => revalidatePath('/kids');

export async function addKidAction(input: { displayName: string; avatar: string; colour: string }): Promise<KidsResult<{ kid: KidView }>> {
  const r = await kids.addKid(await webKidsCaller(), input);
  if (r.ok) refresh();
  return r;
}

export async function removeKidAction(kidId: string): Promise<KidsResult> {
  const r = await kids.removeKid(await webKidsCaller(), kidId);
  if (r.ok) refresh();
  return r;
}

export async function openRoundAction(input: { recipeIds: string[]; forDate?: string; days?: number; title?: string; closesAt?: string | null }): Promise<KidsResult<{ roundId: string }>> {
  const r = await kids.openRound(await webKidsCaller(), input);
  if (r.ok) refresh();
  return r;
}

export async function closeRoundAction(roundId: string): Promise<KidsResult> {
  const r = await kids.closeRound(await webKidsCaller(), roundId);
  if (r.ok) {
    refresh();
    revalidatePath('/plan');
  }
  return r;
}

export async function voteAction(input: { roundId: string; recipeId: string; kidId?: string | null; value: 'up' | 'heart' | null }): Promise<KidsResult> {
  return kids.castVote(await webKidsCaller(), input);
}
