import { notFound } from 'next/navigation';
import { getRecipeRepository } from '../../../lib/recipes/factory';
import { getFreshRecipeCalculator } from '../../../lib/server/calc';
import { getAppContext } from '../../../lib/server/context';
import { loadCooking, withCooking } from '../../../lib/server/cooking/service';
import { webCookingCaller } from '../../../lib/server/cooking/web-caller';
import { RecipeDetail } from '../_components/RecipeDetail';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const recipe = UUID.test(id) ? await getRecipeRepository().get(id) : null;
  return { title: recipe?.title ?? 'Recipe' };
}

export default async function Page({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const recipe = UUID.test(id) ? await getRecipeRepository().get(id) : null;
  if (!recipe) notFound();
  const { householdId, userId, defaultServings } = await getAppContext();
  const caller = await webCookingCaller();
  const [withC] = await withCooking(caller, [recipe]);
  const cooking = await loadCooking(caller, recipe.id);
  return <RecipeDetail recipe={withC ?? recipe} cooking={cooking.ok ? cooking.cooking : null} calc={(await getFreshRecipeCalculator(householdId)).forRecipe(recipe)} justDuplicated={sp.duplicated === '1'} householdId={householdId} userId={userId} householdServings={defaultServings} />;
}
