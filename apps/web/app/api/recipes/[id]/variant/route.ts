import { getRecipeRepositoryFor } from '../../../../../lib/recipes/factory';
import { apiError, bodyHousehold, guarded, json, notFound, readJson } from '../../../../../lib/server/api/bearer-route';
import { saveVariant } from '../../../../../lib/server/cooking/variant';
import { loadPlanServices } from '../../../../../lib/server/plan/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/recipes/[id]/variant { householdId?, swaps: [{ lineId, name, guidance? }], title? } -> { id, title } (a NEW recipe).
 * "Save as a recipe variant": a copy with the swaps applied; the original is untouched. Each swap is re-checked against the
 * household exclusions (422 EXCLUDED when one fails).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readJson(req);
  return guarded(req, bodyHousehold(body), { write: true }, async (auth) => {
    const svc = await loadPlanServices(auth.householdId);
    const r = await saveVariant({ repo: getRecipeRepositoryFor(auth.householdId), recipeId: id, raw: body, household: svc.household });
    if (r.ok) return json({ id: r.id, title: r.title });
    if (r.code === 'NOT_FOUND') return notFound(r.message);
    return apiError(r.code === 'SAVE_FAILED' ? 500 : 422, r.code, r.message, r.code === 'SAVE_FAILED');
  });
}
