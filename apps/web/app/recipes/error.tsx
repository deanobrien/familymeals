'use client';

import { ErrorState } from '@fr/ui';

export default function RecipesError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <>
      <h1>Recipes</h1>
      <ErrorState title="Could not load recipes" onRetry={reset} />
    </>
  );
}
