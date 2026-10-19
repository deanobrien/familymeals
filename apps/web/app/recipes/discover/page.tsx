import Link from 'next/link';
import { getAppContext } from '../../../lib/server/context';
import { getRecipeSource, recipeSourceStatus } from '../../../lib/server/discover/source';
import { DiscoverView } from './discover-view';
import styles from '../recipes.module.css';

export const metadata = { title: 'Discover recipes' };
// Provider status and live lists depend on server env and the network, so render per request.
export const dynamic = 'force-dynamic';

export default async function Page() {
  await getAppContext(); // signed-in household only
  const status = recipeSourceStatus();
  let categories: string[] = [];
  let areas: string[] = [];
  try {
    [categories, areas] = await Promise.all([getRecipeSource().categories(), getRecipeSource().areas()]);
  } catch {
    // The filters just stay empty; searching by name still reports a readable error if the source is down.
  }
  return (
    <>
      <div className={styles.header}>
        <h1>Discover recipes</h1>
        <Link href="/recipes" className="fr-btn fr-btn--secondary">Back to my recipes</Link>
      </div>
      <p>Find new recipes to try. Nothing is added until you review and save it.</p>
      <DiscoverView categories={categories} areas={areas} sourceLabel={status.label} sourceNote="" />
    </>
  );
}
