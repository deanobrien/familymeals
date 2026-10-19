import { redirect } from 'next/navigation';
import { getAppContext } from '../../../../lib/server/context';
import { sameOwner } from '../../../../lib/server/import/pipeline';
import { getUpload } from '../../../../lib/server/import/upload-store';
import { RepositoryRecipeSink } from '../../../../lib/server/import/sink';
import { getRecipeRepository } from '../../../../lib/recipes/factory';
import { DiscoverReview } from './discover-review';

export const metadata = { title: 'Review discovered recipe' };
export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<{ u?: string | string[] }> }) {
  const ctx = await getAppContext();
  const u = (await searchParams).u;
  const id = Array.isArray(u) ? u[0] : u;
  const rec = id ? getUpload(id) : undefined;
  if (!id || !rec?.draft || !sameOwner(rec.owner, { userId: ctx.userId, householdId: ctx.householdId })) redirect('/recipes/discover?expired=1');
  const existing = await new RepositoryRecipeSink(getRecipeRepository()).list();
  return (
    <>
      <h1>Save a discovered recipe</h1>
      <DiscoverReview uploadId={id} draft={rec.draft} existing={existing} />
    </>
  );
}
