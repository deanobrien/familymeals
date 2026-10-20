import { badRequest, bodyHousehold, guarded, isRecord, json, readJson } from '../../../../lib/server/api/bearer-route';
import { getIngredientCatalogue } from '../../../../lib/server/refdata/catalogue';
import { previewLinks } from '../../../../lib/server/recipes/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_NAMES = 100;

/** POST /api/catalogue/match { householdId?, names } -> { suggestions: LinkSuggestion[] } (read-only; at most 100 names). */
export async function POST(req: Request) {
  const body = await readJson(req);
  return guarded(req, bodyHousehold(body), {}, async () => {
    if (!isRecord(body) || !Array.isArray(body.names) || !body.names.every((n) => typeof n === 'string')) {
      return badRequest('Send { names: string[] } as JSON.');
    }
    if (body.names.length > MAX_NAMES) return badRequest(`Send at most ${MAX_NAMES} names.`);
    return json({ suggestions: previewLinks(getIngredientCatalogue(), body.names as string[]) });
  });
}
