'use server';

import { z } from 'zod';
import { getAppContext } from '../../../lib/server/context';
import { discoverIdeas, discoverSearch, startDiscoverDraft, type DiscoverOutcome, type DraftOutcome } from '../../../lib/server/discover/service';
import { loadPlanServices } from '../../../lib/server/plan/services';

const text = (max: number) => z.string().trim().max(max).optional();
const DIETS = z.enum(['meat', 'fish', 'vegetarian', 'vegan']);

const searchSchema = z.object({ q: text(80), area: text(40), category: text(40), ingredient: text(60) });

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
  return { ctx, household: (await loadPlanServices(ctx.householdId)).household };
}

export async function searchRecipesAction(input: unknown): Promise<DiscoverOutcome> {
  const p = searchSchema.safeParse(input);
  if (!p.success) return { ok: false, message: 'That search is not valid.' };
  const { household: h } = await household();
  const { q, area, category, ingredient } = p.data;
  if (!q && !area && !category && !ingredient) return { ok: true, cards: [], withheld: 0, withheldUnverifiable: 0, exclusionsActive: false, sourceLabel: '' };
  return discoverSearch({ ...(q ? { q } : {}), ...(area ? { area } : {}), ...(category ? { category } : {}), ...(ingredient ? { ingredient } : {}) }, h);
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
  const p = z.string().regex(/^\d{1,12}$/).safeParse(id);
  if (!p.success) return { ok: false, message: 'That recipe id is not valid.' };
  const { ctx, household: h } = await household();
  if (ctx.readOnly) return { ok: false, message: 'This household is read-only while it is pending deletion.' };
  return startDiscoverDraft(p.data, { userId: ctx.userId, householdId: ctx.householdId }, h);
}
