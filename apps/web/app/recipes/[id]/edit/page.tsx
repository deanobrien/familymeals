import { notFound } from 'next/navigation';
import { getRecipeRepository } from '../../../../lib/recipes/factory';
import { getIngredientCatalogue } from '../../../../lib/server/refdata/catalogue';
import { RecipeForm } from '../../_components/RecipeForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Edit recipe' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const recipe = UUID.test(id) ? await getRecipeRepository().get(id) : null;
  if (!recipe) notFound();
  const catalogue = getIngredientCatalogue();
  const linkNames: Record<string, string> = {};
  for (const i of recipe.ingredients) {
    const name = i.ingredientId ? catalogue.get(i.ingredientId)?.name : undefined;
    if (i.ingredientId && name) linkNames[i.ingredientId] = name;
  }
  return (
    <>
      <h1>Edit recipe</h1>
      <RecipeForm recipe={recipe} linkNames={linkNames} />
    </>
  );
}
