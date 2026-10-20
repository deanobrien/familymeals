'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { EmptyState, RecipeCard, RecipeGrid, useToast, type RecipeView as ViewMode } from '@fr/ui';
import { imageSrc } from '../../../lib/server/images/paths';
import { recipeQueryToParams, type RecipeQuery } from '../../../lib/recipes/schema';
import { costPerServing, totalMinutes, type RecipeView } from '../../../lib/recipes/types';
import { toggleFavouriteAction } from '../actions';
import styles from '../recipes.module.css';

interface Props {
  items: RecipeView[];
  total: number;
  page: number;
  pageCount: number;
  query: RecipeQuery;
  view: ViewMode;
  hasAnyRecipes: boolean;
}

export function RecipeResults({ items, total, page, pageCount, query, view, hasAnyRecipes }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  const toggle = (id: string) =>
    startTransition(async () => {
      const res = await toggleFavouriteAction(id);
      if (!res.ok) toast.toast({ message: 'Could not update favourite', tone: 'error' });
      router.refresh();
    });

  const pageHref = (p: number) => {
    const qs = recipeQueryToParams({ ...query, page: p, view }).toString();
    return qs ? `/recipes?${qs}` : '/recipes';
  };

  if (items.length === 0) {
    return hasAnyRecipes ? (
      <EmptyState
        icon="search"
        title="No recipes match"
        description="Try a different search or clear some filters."
        action={<Link href="/recipes" className="fr-btn fr-btn--secondary">Clear all filters</Link>}
      />
    ) : (
      <EmptyState
        icon="book"
        title="No recipes yet"
        description="Recipes you add or import will live here."
        action={<Link href="/recipes/new" className="fr-btn fr-btn--primary">Add a recipe</Link>}
      />
    );
  }

  return (
    <div className={pending ? styles.pending : undefined}>
      <p className={styles.summary} role="status">
        {total} {total === 1 ? 'recipe' : 'recipes'}
      </p>
      <RecipeGrid view={view}>
        {items.map((r) => (
          <RecipeCard
            key={r.id}
            title={r.title}
            href={`/recipes/${r.id}`}
            imageUrl={imageSrc(r.imageUrl)}
            totalMinutes={totalMinutes(r)}
            costPerServingPence={costPerServing(r)}
            tags={r.tags}
            favourite={r.favourite}
            onToggleFavourite={() => toggle(r.id)}
            variant={view === 'list' ? 'row' : 'card'}
            linkComponent={Link}
          />
        ))}
      </RecipeGrid>
      {pageCount > 1 && (
        <nav className={styles.pager} aria-label="Pagination">
          {page > 1 ? <Link href={pageHref(page - 1)} rel="prev">Previous</Link> : <span className={styles.disabled}>Previous</span>}
          <span aria-current="page">Page {page} of {pageCount}</span>
          {page < pageCount ? <Link href={pageHref(page + 1)} rel="next">Next</Link> : <span className={styles.disabled}>Next</span>}
        </nav>
      )}
    </div>
  );
}
