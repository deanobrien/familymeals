import Link from 'next/link';
import { ErrorState } from '@fr/ui';
import { withCooking } from '../../lib/server/cooking/service';
import { webCookingCaller } from '../../lib/server/cooking/web-caller';
import { getRecipeRepository } from '../../lib/recipes/factory';
import { parseRecipeQuery } from '../../lib/recipes/schema';
import { RecipeFilters } from './_components/RecipeFilters';
import { RematchAllButton } from './_components/RematchButtons';
import { RecipeResults } from './_components/RecipeResults';
import styles from './recipes.module.css';

export const metadata = { title: 'Recipes' };
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const query = parseRecipeQuery(params);
  const viewParam = Array.isArray(params.view) ? params.view[0] : params.view;
  const view = viewParam === 'list' ? 'list' : 'grid';
  const deleted = params.deleted === '1';

  let data;
  try {
    const repo = getRecipeRepository();
    const [list, cuisines, tags, all] = await Promise.all([
      repo.list(query),
      repo.listCuisines(),
      repo.listTags(),
      repo.list({ q: '', tags: [], sort: 'name', page: 1, pageSize: 1 }),
    ]);
    // Rating mean and last cooked ride along on each card (a failure here never blocks the list).
    const items = await withCooking(await webCookingCaller(), list.items);
    data = { list: { ...list, items }, cuisines, tags, hasAny: all.total > 0 };
  } catch (err) {
    console.error('Failed to load recipes', err);
    return (
      <>
        <h1>Recipes</h1>
        <ErrorState title="Could not load recipes" description="Please refresh the page. If it keeps happening, let us know." />
      </>
    );
  }

  return (
    <div className="fr-has-fab">
      <div className={styles.header}>
        <h1>Recipes</h1>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <Link href="/recipes/import" className={`fr-btn fr-btn--primary ${styles.linkBtn}`} data-testid="add-from-photo">
            <span aria-hidden="true">📷</span> Add from photo
          </Link>
          <Link href="/recipes/new" className={`fr-btn fr-btn--secondary ${styles.linkBtn}`}>
            New recipe
          </Link>
          <Link href="/recipes/discover" className={`fr-btn fr-btn--secondary ${styles.linkBtn}`}>
            Discover
          </Link>
        </div>
      </div>
      {deleted && <p className={styles.banner} role="status">Recipe deleted.</p>}
      <RecipeFilters query={query} view={view} cuisines={data.cuisines} tags={data.tags} />
      <RecipeResults
        items={data.list.items}
        total={data.list.total}
        page={data.list.page}
        pageCount={data.list.pageCount}
        query={query}
        view={view}
        hasAnyRecipes={data.hasAny}
      />
      {data.hasAny && <RematchAllButton />}
      <Link href="/recipes/import" className="fr-btn fr-btn--primary fr-fab" data-testid="add-from-photo-fab">
        <span aria-hidden="true">📷</span> Add from photo
      </Link>
    </div>
  );
}
