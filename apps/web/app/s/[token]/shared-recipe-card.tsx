'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Button, Card, CardBody, formatMinutes } from '@fr/ui';
import type { SharedRecipeView } from '../../../lib/sharing/types';
import { saveShareCopyAction } from '../../recipes/share-actions';

/** One recipe in a share: read-only, with "Save a copy to my household" for a signed-in person from another household. */
export function SharedRecipeCard({ token, recipe, canSave }: { token: string; recipe: SharedRecipeView; canSave: boolean }) {
  const [saved, setSaved] = useState<{ id: string; imageCopied: boolean } | null>(null);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      setError('');
      const r = await saveShareCopyAction(token, recipe.id);
      if (!r.ok) return setError(r.message);
      setSaved({ id: r.recipeId, imageCopied: r.imageCopied });
    });

  return (
    <Card>
      <CardBody>
        <article data-testid={`shared-recipe-${recipe.id}`} style={{ display: 'grid', gap: '0.75rem' }}>
          <h2 style={{ margin: 0 }}>{recipe.title}</h2>
          {recipe.imagePath && <img src={recipe.imagePath} alt={recipe.title} style={{ maxWidth: '100%', borderRadius: 8 }} referrerPolicy="no-referrer" />}
          {recipe.description && <p>{recipe.description}</p>}
          <p className="fr-muted">
            Serves {recipe.servings}
            {recipe.prepMinutes != null ? ` · prep ${formatMinutes(recipe.prepMinutes)}` : ''}
            {recipe.cookMinutes != null ? ` · cook ${formatMinutes(recipe.cookMinutes)}` : ''}
            {recipe.sourceAttribution ? ` · ${recipe.sourceAttribution}` : ''}
          </p>
          <h3>Ingredients</h3>
          <ul>
            {recipe.ingredients.map((i, n) => (
              <li key={n}>{i.text}{i.optional ? ' (optional)' : ''}</li>
            ))}
          </ul>
          <h3>Method</h3>
          <ol>
            {recipe.steps.map((s, n) => (
              <li key={n}>{s}</li>
            ))}
          </ol>
          {canSave && !saved && (
            <div>
              <Button onClick={save} loading={pending} data-testid={`save-copy-${recipe.id}`}>Save a copy to my household</Button>
            </div>
          )}
          {saved && (
            <p role="status" data-testid="share-saved">
              Saved to your household{saved.imageCopied ? ' with its photo' : ''}. <Link href={`/recipes/${saved.id}`}>Open your copy</Link>
            </p>
          )}
          {error && <p role="alert" style={{ color: 'var(--fr-danger)' }}>{error}</p>}
        </article>
      </CardBody>
    </Card>
  );
}
