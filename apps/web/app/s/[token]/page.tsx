import Link from 'next/link';
import { headers } from 'next/headers';
import { Badge } from '@fr/ui';
import { webShareViewer } from '../../../lib/server/sharing/callers';
import { previewShare } from '../../../lib/server/sharing/service';
import { SHARE_ERROR_MESSAGE, SHARE_TOKEN_RE, shareAppUrl } from '../../../lib/sharing/types';
import { SharedRecipeCard } from './shared-recipe-card';

// A share link must not leak into search results or Referer headers.
export const metadata = { title: 'A shared recipe', robots: { index: false, follow: false }, referrer: 'no-referrer' as const };
export const dynamic = 'force-dynamic';

const wrap = { maxWidth: 760, margin: '2rem auto', padding: '0 1rem', display: 'grid', gap: '1rem' } as const;

export default async function SharedPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const unavailable = (
    <main style={wrap}>
      <h1>This link is not available</h1>
      <p data-testid="share-unavailable">{SHARE_ERROR_MESSAGE.not_found}</p>
      <p><Link href="/">Go to Family Recipes</Link></p>
    </main>
  );
  if (!SHARE_TOKEN_RE.test(token)) return unavailable;

  const viewer = await webShareViewer();
  const h = await headers();
  const r = await previewShare(viewer, token, { headers: h });
  if (!r.ok) {
    return (
      <main style={wrap}>
        <h1>Please wait a moment</h1>
        <p role="alert">{r.message}</p>
      </main>
    );
  }
  const p = r.preview;
  if (p.kind === 'invalid') return unavailable;

  const next = encodeURIComponent(`/s/${token}`);
  const signIn = (
    <p data-testid="share-sign-in">
      <Link href={`/sign-in?next=${next}`}>Sign in</Link> or <Link href={`/sign-up?next=${next}`}>create an account</Link> to read it in full and save a copy to your household.
    </p>
  );

  if (p.kind === 'minimal') {
    return (
      <main style={wrap}>
        <h1 data-testid="share-title">{p.title ?? 'A shared recipe'}</h1>
        <p>
          {p.sharedBy ? `${p.sharedBy}'s household` : 'Another household'} has shared {p.scope === 'collection' ? `${p.recipeCount} recipe${p.recipeCount === 1 ? '' : 's'}` : 'a recipe'} with you on Family Recipes.
        </p>
        {signIn}
        <p><a href={shareAppUrl(token)} data-testid="open-share-in-app">Open this in the Android app</a></p>
      </main>
    );
  }

  return (
    <main style={wrap}>
      <h1 data-testid="share-title">{p.scope === 'collection' ? (p.title ?? 'Shared recipes') : (p.recipes[0]?.title ?? 'A shared recipe')}</h1>
      <p data-testid="share-attribution"><Badge tone="accent">{p.attribution}</Badge></p>
      {p.expiresAt && <p className="fr-muted">This link stops working on {new Date(p.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.</p>}
      {!p.signedIn && signIn}
      {p.own && <p role="status">This is a link your own household made, so these recipes are already yours.</p>}
      {p.recipes.length === 0 && <p>There are no recipes to show.</p>}
      {p.recipes.map((rc) => (
        <SharedRecipeCard key={rc.id} token={token} recipe={rc} canSave={p.signedIn && !p.own} />
      ))}
      <p><a href={shareAppUrl(token)} data-testid="open-share-in-app">Open this in the Android app</a></p>
    </main>
  );
}
