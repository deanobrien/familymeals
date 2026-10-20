import { getRecipeRepositoryFor } from '../../../../../lib/recipes/factory';
import { apiError, badRequest, bodyHousehold, guarded, isRecord, json, notFound, readJson } from '../../../../../lib/server/api/bearer-route';
import { settingsAiProvider } from '../../../../../lib/server/ai/provider';
import { suggestSubstitutionsFor } from '../../../../../lib/server/cooking/substitutions';
import { loadPlanServices } from '../../../../../lib/server/plan/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/recipes/[id]/substitutions { householdId?, lineId } -> { ingredient, suggestions[], withheld, withheldUnverifiable, exclusionsActive }.
 * AI suggestions (provider gateway) re-checked on the server against the household's hard exclusions and allergen groups;
 * anything excluded or unverifiable is dropped before it leaves the server. Never changes the recipe.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readJson(req);
  // Not a write (nothing is stored), so it also works while the household is read-only.
  return guarded(req, bodyHousehold(body), {}, async (auth) => {
    if (!isRecord(body) || typeof body.lineId !== 'string' || !body.lineId) return badRequest('Send { lineId }.');
    const recipe = UUID.test(id) ? await getRecipeRepositoryFor(auth.householdId).get(id) : null;
    if (!recipe) return notFound('Recipe not found.');
    const svc = await loadPlanServices(auth.householdId);
    const out = await suggestSubstitutionsFor({ recipe, lineId: body.lineId, household: svc.household, ai: settingsAiProvider, householdId: auth.householdId });
    if (out.ok) return json(out);
    if (out.code === 'NOT_FOUND') return notFound(out.message);
    return apiError(503, out.code, out.message, true);
  });
}
