'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@fr/ui';
import { cookedLabel, ratingLabel } from '@fr/engine/cooking';
import type { RecipeCookingView } from '../../../../lib/server/cooking/service';
import { setDontSuggestAction } from '../../cooking-actions';
import { MarkCookedForm } from './MarkCookedForm';
import rstyles from '../../recipes.module.css';
import styles from './cooking.module.css';

interface Props {
  recipeId: string;
  recipeTitle: string;
  servings: number;
  /** Household mean rating (recipe.rating). */
  averageRating: number | null;
  cooking: RecipeCookingView | null;
}

/** Recipe detail: average rating, last cooked, the member's own rating, history with notes, mark as cooked, don't-suggest. */
export function CookingPanel({ recipeId, recipeTitle, servings, averageRating, cooking: initial }: Props) {
  const router = useRouter();
  const [cooking, setCooking] = useState<RecipeCookingView | null>(initial);
  useEffect(() => setCooking(initial), [initial]);
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now] = useState(() => Date.now());

  const toggleNever = async () => {
    if (!cooking) return;
    setBusy(true);
    try {
      const r = await setDontSuggestAction(recipeId, !cooking.dontSuggest);
      if (r.ok) {
        setCooking(r.cooking);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={rstyles.panel} aria-labelledby="cooking-h" data-testid="cooking-panel" style={{ marginTop: 'var(--fr-space-5)' }}>
      <h2 id="cooking-h">Cooking</h2>
      <p data-testid="cooked-summary">
        {cookedLabel(cooking, now)}
        {averageRating != null && <> · Household rating <strong aria-label={`${averageRating} out of 5`}>{ratingLabel(averageRating)}</strong></>}
        {cooking?.myRating != null && <> · You rated it <strong>{cooking.myRating}/5</strong></>}
      </p>
      {flash && <p role="status" data-testid="cooked-flash">{flash}</p>}
      {!open ? (
        <div style={{ display: 'flex', gap: 'var(--fr-space-2)', flexWrap: 'wrap' }}>
          <Button onClick={() => { setOpen(true); setFlash(null); }} data-testid="mark-cooked">Mark as cooked</Button>
          {cooking && (
            <Button variant="secondary" onClick={() => void toggleNever()} loading={busy} aria-pressed={cooking.dontSuggest} data-testid="dont-suggest">
              {cooking.dontSuggest ? 'Planner skips this (undo)' : "Don't suggest again"}
            </Button>
          )}
        </div>
      ) : (
        <MarkCookedForm
          recipeId={recipeId}
          recipeTitle={recipeTitle}
          servings={servings}
          currentRating={cooking?.myRating ?? null}
          onCancel={() => setOpen(false)}
          onSaved={(c) => { setCooking(c); setOpen(false); setFlash('Saved. Thanks, that helps the planner.'); router.refresh(); }}
        />
      )}
      {cooking && cooking.dontSuggestCount > 0 && !cooking.dontSuggest && <p className="fr-muted">{cooking.dontSuggestCount} household member{cooking.dontSuggestCount === 1 ? '' : 's'} asked the planner not to suggest this.</p>}
      {cooking && cooking.history.length > 0 && (
        <ul className={styles.history} aria-label="Cooked history" data-testid="cook-history">
          {cooking.history.map((h) => (
            <li key={h.id}>
              <strong>{new Date(h.cookedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</strong>
              {' · '}{h.servings} serving{h.servings === 1 ? '' : 's'}
              {' · '}{h.cookedBy ?? 'Someone'}
              {h.rating != null && <> · <span role="img" aria-label={`${h.rating} out of 5`}>{"★".repeat(h.rating)}</span></>}
              {h.note && <span className={styles.noteText}>&ldquo;{h.note.text}&rdquo; {h.note.isPrivate ? '(private)' : '(household)'}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
