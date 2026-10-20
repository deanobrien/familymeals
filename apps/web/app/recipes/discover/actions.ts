'use server';

import { z } from 'zod';
import { getAppContext } from '../../../lib/server/context';
import { discoverIdSchema, discoverSearchSchema, draftDiscover, loadDiscoverHousehold, searchDiscover } from '../../../lib/server/discover/api';
import { discoverIdeas, type DiscoverOutcome, type DraftOutcome } from '../../../lib/server/discover/service';

const DIETS = z.enum(['meat', 'fish', 'vegetarian', 'vegan']);

/** The household's own hard exclusions are always applied; the browser can only add to them. */
const extraSchema = z.object({
  terms: z.array(z.string().trim().min(1).max(60)).max(40).optional(),
  allergens: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  excludeDiets: z.array(DIETS).max(4).optional(),
}).optional();

const ideasSchema = z.object({
  criteria: z.object({
    dietCategory: DIETS.optional(),
    mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack']).optional(),
    maxTotalMinutes: z.number().int().positive().max(1000).optional(),
    maxCostPerServingPence: z.number().int().min(0).max(100000).optional(),
  }),
  extra: extraSchema,
});

async function household() {
  const ctx = await getAppContext();
  return { ctx, household: await loadDiscoverHousehold(ctx.householdId) };
}

export async function searchRecipesAction(input: unknown): Promise<DiscoverOutcome> {
  const p = discoverSearchSchema.safeParse(input);
  if (!p.success) return { ok: false, message: 'That search is not valid.' };
  const { household: h } = await household();
  return searchDiscover(p.data, h);
}

export async function findIdeasAction(input: unknown): Promise<DiscoverOutcome> {
  const p = ideasSchema.safeParse(input);
  if (!p.success) return { ok: false, message: 'Those criteria are not valid.' };
  const { household: h } = await household();
  const x = p.data.extra;
  return discoverIdeas(p.data.criteria, h, {
    ...(x?.terms ? { terms: x.terms } : {}),
    ...(x?.allergens ? { allergens: x.allergens } : {}),
    ...(x?.excludeDiets ? { excludeDiets: x.excludeDiets } : {}),
  });
}

export async function draftFromSourceAction(id: unknown): Promise<DraftOutcome> {
  const p = discoverIdSchema.safeParse(id);
  if (!p.success) return { ok: false, message: 'That recipe id is not valid.' };
  const { ctx, household: h } = await household();
  if (ctx.readOnly) return { ok: false, message: 'This household is read-only while it is pending deletion.' };
  return draftDiscover(p.data, { userId: ctx.userId, householdId: ctx.householdId }, h);
}
