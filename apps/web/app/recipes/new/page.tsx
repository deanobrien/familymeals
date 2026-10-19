import { RecipeForm } from '../_components/RecipeForm';

export const metadata = { title: 'New recipe' };

export default function Page() {
  return (
    <>
      <h1>New recipe</h1>
      <RecipeForm />
    </>
  );
}
