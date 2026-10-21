'use client';

// "Share this recipe" on the recipe page (P3-A, D420). Collapsed by default: sharing is a deliberate act.
import { useCallback, useEffect, useState } from 'react';
import { listSharesAction } from '../../share-actions';
import type { ShareSummary } from '../../../../lib/sharing/types';
import styles from '../../recipes.module.css';
import { CreateShareForm, ShareList } from './ShareControls';

export function SharePanel({ recipeId, recipeTitle }: { recipeId: string; recipeTitle: string }) {
  const [open, setOpen] = useState(false);
  const [shares, setShares] = useState<ShareSummary[]>([]);
  const load = useCallback(async () => {
    const r = await listSharesAction();
    if (r.ok) setShares(r.shares.filter((x) => x.scope === 'recipe' && x.recipes.some((rc) => rc.id === recipeId)));
  }, [recipeId]);
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  return (
    <details className={styles.panel} open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)} data-testid="share-panel">
      <summary>Share this recipe with another household</summary>
      <p className="fr-muted">
        Make a link and send it to a friend or relative. They can read this recipe and save their own copy. Your notes, ratings and cooking history are never shared, and
        you can switch the link off at any time.
      </p>
      <CreateShareForm scope="recipe" recipeIds={[recipeId]} label={`"${recipeTitle}"`} onCreated={() => void load()} />
      <h3>Links for this recipe</h3>
      <ShareList shares={shares} onChanged={() => void load()} />
    </details>
  );
}
