import { notFound } from 'next/navigation';
import type { CookSwap } from '@fr/engine/cooking';
import { getRecipeRepository } from '../../../../lib/recipes/factory';
import { resolveInitialServings, validServings } from '../../../../lib/recipes/initial-servings';
import { getAppContext } from '../../../../lib/server/context';
import { loadCooking } from '../../../../lib/server/cooking/service';
import { checkSubstitute } from '../../../../lib/server/cooking/substitutions';
import { webCookingCaller } from '../../../../lib/server/cooking/web-caller';
import { loadPlanServices } from '../../../../lib/server/plan/services';
import { CookMode } from '../../_components/cooking/CookMode';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Cook mode' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function Page({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const recipe = UUID.test(id) ? await getRecipeRepository().get(id) : null;
  if (!recipe) notFound();
  const { householdId, userId, defaultServings } = await getAppContext();

  const pinned = Number(Array.isArray(sp.servings) ? sp.servings[0] : sp.servings);
  const servingsPinned = validServings(pinned);
  const initialServings = servingsPinned ? pinned : resolveInitialServings(defaultServings);

  // "Cook with this swap" arrives in the URL, which anyone can edit: every swap is re-checked against this household's
  // exclusions here, and one that fails (or names a line the recipe does not have) is silently dropped.
  const raw = (Array.isArray(sp.swap) ? sp.swap : sp.swap ? [sp.swap] : []).slice(0, 10);
  const swaps: CookSwap[] = [];
  if (raw.length > 0) {
    const svc = await loadPlanServices(householdId);
    for (const r of raw) {
      const [lineId = '', name = '', ...rest] = r.split('|');
      const guidance = rest.join('|').slice(0, 200);
      if (!recipe.ingredients.some((l) => l.id === lineId) || !name.trim() || name.length > 80) continue;
      if (checkSubstitute(name.trim(), guidance, svc.household).ok) swaps.push({ lineId, name: name.trim(), guidance });
    }
  }

  const c = await loadCooking(await webCookingCaller(), id).catch(() => null);
  return (
    <CookMode
      recipe={recipe}
      initialServings={initialServings}
      servingsPinned={servingsPinned}
      householdId={householdId}
      userId={userId}
      incomingSwaps={swaps}
      currentRating={c && c.ok ? c.cooking.myRating : null}
    />
  );
}
