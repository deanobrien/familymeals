'use client';

import { useState, useTransition } from 'react';
import { Button, Checkbox, Select, Stepper, Textarea } from '@fr/ui';
import type { RecipeCookingView } from '../../../../lib/server/cooking/service';
import { markCookedAction, setDontSuggestAction } from '../../cooking-actions';
import styles from './cooking.module.css';

interface Props {
  recipeId: string;
  recipeTitle: string;
  servings: number;
  /** The member's current rating, pre-selected. */
  currentRating?: number | null;
  /** `leftover` is set when "Cook in bulk" recorded extra portions (P2-C). */
  onSaved: (cooking: RecipeCookingView, leftover?: { portions: number; storedIn: 'fridge' | 'freezer'; useBy: string }) => void;
  onCancel?: () => void;
}

/** "Mark as cooked": servings, a 1-5 rating, a private or household note, and "don't suggest again". */
export function MarkCookedForm({ recipeId, recipeTitle, servings: initial, currentRating = null, onSaved, onCancel }: Props) {
  const [servings, setServings] = useState(initial);
  const [rating, setRating] = useState<number | null>(currentRating);
  const [note, setNote] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'household'>('private');
  const [never, setNever] = useState(false);
  const [multiplier, setMultiplier] = useState(1);
  const [storedIn, setStoredIn] = useState<'fridge' | 'freezer'>('fridge');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      setError(null);
      try {
        const r = await markCookedAction(recipeId, {
          servings, rating, note: note.trim() || null, notePrivate: visibility === 'private',
          ...(multiplier > 1 ? { batch: { multiplier, storedIn }, today: localToday() } : {}),
        });
        if (!r.ok) {
          setError(r.error === 'invalid_input' ? Object.values(r.fieldErrors ?? {})[0] ?? 'Some values were not accepted.' : r.error === 'read_only' ? 'This household is read-only while it is pending deletion.' : 'Could not save. Please try again.');
          return;
        }
        let cooking = r.cooking;
        if (never) {
          const d = await setDontSuggestAction(recipeId, true);
          if (d.ok) cooking = d.cooking;
        }
        onSaved(cooking, r.leftover ? { portions: r.leftover.portionsMade, storedIn: r.leftover.storedIn, useBy: r.leftover.useBy } : undefined);
      } catch {
        setError('Could not save. Please try again.');
      }
    });

  return (
    <form className={styles.markForm} aria-label={`Mark ${recipeTitle} as cooked`} onSubmit={(e) => { e.preventDefault(); submit(); }} data-testid="mark-cooked-form">
      <h3>How did it go?</h3>
      <Stepper label="Servings cooked" value={servings} min={1} max={100} onChange={setServings} />
      <fieldset className={styles.stars}>
        <legend>Your rating</legend>
        <div role="group" aria-label="Rating, 1 to 5 stars">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              className={styles.star}
              aria-pressed={rating === n}
              aria-label={`${n} star${n === 1 ? '' : 's'}`}
              data-testid={`rate-${n}`}
              onClick={() => setRating(rating === n ? null : n)}
            >
              <span aria-hidden="true">{rating !== null && n <= rating ? '★' : '☆'}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <Textarea label="Note for next time (optional)" value={note} maxLength={1000} rows={3} placeholder="Less chilli next time" onChange={(e) => setNote(e.target.value)} />
      <Select
        label="Who can see the note"
        value={visibility}
        onChange={(e) => setVisibility(e.target.value as 'private' | 'household')}
        options={[{ value: 'private', label: 'Only me' }, { value: 'household', label: 'My household' }]}
      />
      <fieldset className={styles.stars} data-testid="batch-options">
        <legend>Cooked extra to keep?</legend>
        <Select
          label="Batch cooking"
          hint="If you cooked more than you ate, the spare portions go on your leftovers list so the planner can use them."
          value={String(multiplier)}
          onChange={(e) => setMultiplier(Number(e.target.value))}
          options={[
            { value: '1', label: 'No, just tonight' },
            { value: '2', label: 'Cook x2 (one more of everything)' },
            { value: '3', label: 'Cook x3' },
            { value: '4', label: 'Cook x4' },
          ]}
        />
        {multiplier > 1 && (
          <Select
            label="Keep the spare portions in"
            hint={`${servings * (multiplier - 1)} spare portion${servings * (multiplier - 1) === 1 ? '' : 's'}. Use-by is 2 days in the fridge or 3 months in the freezer.`}
            value={storedIn}
            onChange={(e) => setStoredIn(e.target.value as 'fridge' | 'freezer')}
            options={[{ value: 'fridge', label: 'Fridge (2 days)' }, { value: 'freezer', label: 'Freezer (3 months)' }]}
          />
        )}
      </fieldset>
      <Checkbox label="Don't suggest this recipe again" checked={never} onChange={(e) => setNever(e.target.checked)} />
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.formButtons}>
        <Button type="submit" loading={pending} data-testid="save-cooked">Save</Button>
        {onCancel && <Button variant="ghost" onClick={onCancel} disabled={pending}>Not now</Button>}
      </div>
    </form>
  );
}

/** The browser's own date (YYYY-MM-DD), so a late-evening cook is dated by the cook's clock, not the server's. */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
