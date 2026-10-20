import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, badRequest } from '../../../../lib/server/api/handle';
import { discoverIdeas } from '../../../../lib/server/discover/service';
import { planPost } from '../../../../lib/server/plan/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DIETS = z.enum(['meat', 'fish', 'vegetarian', 'vegan']);
const bodySchema = z.object({
  criteria: z.object({
    dietCategory: DIETS.optional(),
    mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack']).optional(),
    maxTotalMinutes: z.number().int().positive().max(1000).optional(),
    maxCostPerServingPence: z.number().int().min(0).max(100000).optional(),
  }),
  // The household's own hard exclusions are always applied server-side; this can only ADD exclusions.
  extra: z.object({
    terms: z.array(z.string().trim().min(1).max(60)).max(40).optional(),
    allergens: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
    excludeDiets: z.array(DIETS).max(4).optional(),
  }).optional(),
});

/** POST { householdId, criteria, extra? }: "Find ideas" for a planner gap (D175). Nothing is added to a plan or the library. */
export async function POST(req: Request) {
  return planPost(req, { write: false }, async (_ctx, svc, body) => {
    const p = bodySchema.safeParse(body);
    if (!p.success) return badRequest('Those criteria are not valid.');
    const x = p.data.extra;
    const out = await discoverIdeas(p.data.criteria, svc.household, {
      ...(x?.terms ? { terms: x.terms } : {}),
      ...(x?.allergens ? { allergens: x.allergens } : {}),
      ...(x?.excludeDiets ? { excludeDiets: x.excludeDiets } : {}),
    });
    return out.ok ? NextResponse.json(out) : apiError(502, 'SOURCE_UNAVAILABLE', out.message, {}, true);
  });
}
