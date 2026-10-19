import { EmptyState } from '@fr/ui';

export const metadata = { title: 'Recipes' };

export default function Page() {
  return (
    <>
      <h1>Recipes</h1>
      <EmptyState icon="book" title="No recipes yet" description="Recipes you add or import will live here." />
    </>
  );
}
