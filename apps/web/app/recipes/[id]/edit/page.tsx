import { notFound } from 'next/navigation';
import { getRecipeRepository } from '../../../../lib/recipes/factory';
import { RecipeForm } from '../../_components/RecipeForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Edit recipe' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const recipe = UUID.test(id) ? await getRecipeRepository().get(id) : null;
  if (!recipe) notFound();
  return (
    <>
      <h1>Edit recipe</h1>
      <RecipeForm recipe={recipe} />
    </>
  );
}
