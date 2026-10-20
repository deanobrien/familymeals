'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, useToast } from '@fr/ui';
import { rematchAllRecipesAction, rematchRecipeAction, type RematchResult } from '../actions';
import styles from '../recipes.module.css';

function message(r: RematchResult): { message: string; tone: 'info' | 'error' } {
  if (!r.ok) return { message: r.message, tone: 'error' };
  const s = r.summary;
  const left = s.ambiguous + s.unmatched;
  return {
    message: `Linked ${s.linked} ingredient${s.linked === 1 ? '' : 's'}${left > 0 ? `; ${left} still need a choice` : ''}.`,
    tone: 'info',
  };
}

/** Notice under a recipe's ingredient list when lines are not linked to the ingredient list (D225). */
export function UnlinkedNotice({ recipeId, unlinked, total }: { recipeId: string; unlinked: number; total: number }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  if (unlinked === 0) return null;
  const run = () =>
    start(async () => {
      toast.toast(message(await rematchRecipeAction(recipeId)));
      router.refresh();
    });
  return (
    <div className={styles.linkNotice} data-testid="unlinked-notice">
      <p className="fr-muted" role="status">
        {unlinked} of {total} ingredients {unlinked === 1 ? 'is' : 'are'} not linked to the ingredient list, so {unlinked === 1 ? 'it is' : 'they are'} left out of cost and nutrition.
      </p>
      <Button variant="secondary" size="sm" onClick={run} disabled={pending} data-testid="rematch-recipe">Re-match ingredients</Button>
      <Link href={`/recipes/${recipeId}/edit`}>Choose matches</Link>
    </div>
  );
}

/** Household-wide backfill (D225). */
export function RematchAllButton() {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      toast.toast(message(await rematchAllRecipesAction()));
      router.refresh();
    });
  return (
    <p className="fr-muted">
      Recipes typed in by hand are matched to the ingredient list when saved.{' '}
      <Button variant="ghost" size="sm" onClick={run} disabled={pending} data-testid="rematch-all">Re-match ingredients in all recipes</Button>
    </p>
  );
}
