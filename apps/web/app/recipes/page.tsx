import Link from 'next/link';
import { ErrorState } from '@fr/ui';
import { getRecipeRepository } from '../../lib/recipes/factory';
import { parseRecipeQuery } from '../../lib/recipes/schema';
import { RecipeFilters } from './_components/RecipeFilters';
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
    data = { list, cuisines, tags, hasAny: all.total > 0 };
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
    <>
      <div className={styles.header}>
        <h1>Recipes</h1>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <Link href="/recipes/discover" className={`fr-btn fr-btn--secondary ${styles.linkBtn}`}>
            Discover
          </Link>
          <Link href="/recipes/new" className={`fr-btn fr-btn--primary ${styles.linkBtn}`}>
            New recipe
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
    </>
  );
}
