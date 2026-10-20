'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { cookedLabel } from '@fr/engine/cooking';
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

/** "★ 4.5 · Cooked 3 times, last 2 days ago"; empty when there is nothing to say yet. */
function cardNote(r: RecipeView): string {
  const parts: string[] = [];
  if (r.rating != null) parts.push(`★ ${Math.round(r.rating * 10) / 10}`);
  if (r.cooked) parts.push(cookedLabel(r.cooked, Date.now()));
  return parts.join(" · ");
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
      <section className="fr-cta" aria-labelledby="recipes-cta-h" data-testid="recipes-empty-cta">
        <h2 id="recipes-cta-h">Photograph a recipe card or cookbook page</h2>
        <p>Snap a photo and we will turn it into a recipe you can edit, scale and cook from.</p>
        <div className="fr-cta__actions">
          <Link href="/recipes/import" className="fr-btn fr-btn--primary fr-btn--lg" data-testid="empty-add-from-photo">
            <span aria-hidden="true">📷</span> Add from photo
          </Link>
          <Link href="/recipes/new" className="fr-btn fr-btn--secondary fr-btn--lg">Type it in</Link>
          <Link href="/recipes/discover" className="fr-btn fr-btn--secondary fr-btn--lg">Discover ideas</Link>
        </div>
      </section>
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
            note={cardNote(r)}
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
