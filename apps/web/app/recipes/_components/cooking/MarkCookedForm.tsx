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
  onSaved: (cooking: RecipeCookingView) => void;
  onCancel?: () => void;
}

/** "Mark as cooked": servings, a 1-5 rating, a private or household note, and "don't suggest again". */
export function MarkCookedForm({ recipeId, recipeTitle, servings: initial, currentRating = null, onSaved, onCancel }: Props) {
  const [servings, setServings] = useState(initial);
  const [rating, setRating] = useState<number | null>(currentRating);
  const [note, setNote] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'household'>('private');
  const [never, setNever] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      setError(null);
      try {
        const r = await markCookedAction(recipeId, { servings, rating, note: note.trim() || null, notePrivate: visibility === 'private' });
        if (!r.ok) {
          setError(r.error === 'invalid_input' ? Object.values(r.fieldErrors ?? {})[0] ?? 'Some values were not accepted.' : r.error === 'read_only' ? 'This household is read-only while it is pending deletion.' : 'Could not save. Please try again.');
          return;
        }
        let cooking = r.cooking;
        if (never) {
          const d = await setDontSuggestAction(recipeId, true);
          if (d.ok) cooking = d.cooking;
        }
        onSaved(cooking);
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
      <Checkbox label="Don't suggest this recipe again" checked={never} onChange={(e) => setNever(e.target.checked)} />
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.formButtons}>
        <Button type="submit" loading={pending} data-testid="save-cooked">Save</Button>
        {onCancel && <Button variant="ghost" onClick={onCancel} disabled={pending}>Not now</Button>}
      </div>
    </form>
  );
}
