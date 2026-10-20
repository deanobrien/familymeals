'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@fr/ui';
import type { CookSwap } from '@fr/engine/cooking';
import type { SubstitutionOutcome } from '../../../../lib/server/cooking/substitutions';
import { saveVariantAction, suggestSubstitutionsAction } from '../../cooking-actions';
import styles from './cooking.module.css';

type Ok = Extract<SubstitutionOutcome, { ok: true }>;

interface Props {
  recipeId: string;
  line: { id: string; name: string };
  /** Swaps already chosen in this cook session; saved together with the new one when making a variant. */
  existingSwaps?: CookSwap[];
  /** Cook mode: use it for this session only (the recipe is not changed). */
  onApply?: (swap: CookSwap) => void;
  /** "Cook with this swap" from the recipe page. */
  cookHref?: (swap: CookSwap) => string;
  onClose: () => void;
}

/**
 * "Out of X?": AI suggestions, already re-checked on the server against the household's allergies and exclusions (anything
 * excluded or unverifiable never reaches this component). Applying is temporary (cook mode) or saves a COPY as a variant.
 */
export function SubstitutionPanel({ recipeId, line, existingSwaps = [], onApply, cookHref, onClose }: Props) {
  const [state, setState] = useState<{ loading: true } | { loading: false; error: string } | { loading: false; data: Ok }>({ loading: true });
  const [saved, setSaved] = useState<{ id: string; title: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setState({ loading: true });
    suggestSubstitutionsAction(recipeId, line.id)
      .then((r) => live && setState(r.ok ? { loading: false, data: r } : { loading: false, error: r.message }))
      .catch(() => live && setState({ loading: false, error: 'Suggestions are not available right now. Please try again shortly.' }));
    return () => {
      live = false;
    };
  }, [recipeId, line.id]);

  const toSwap = (s: { substitute: string; quantityGuidance: string }): CookSwap => ({ lineId: line.id, name: s.substitute, guidance: s.quantityGuidance });

  const saveVariant = async (swap: CookSwap) => {
    setBusy(swap.name);
    setSaveError(null);
    try {
      const swaps = [...existingSwaps.filter((e) => e.lineId !== swap.lineId), swap];
      const r = await saveVariantAction(recipeId, { swaps: swaps.map((s) => ({ lineId: s.lineId, name: s.name, ...(s.guidance ? { guidance: s.guidance } : {}) })) });
      if (r.ok) setSaved({ id: r.id, title: r.title });
      else setSaveError(r.message);
    } catch {
      setSaveError('The variant could not be saved. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={styles.subPanel} aria-label={`Substitutes for ${line.name}`} data-testid="substitution-panel">
      <div className={styles.subHead}>
        <h3>Out of {line.name}?</h3>
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>
      {state.loading && <p role="status">Looking for substitutes...</p>}
      {!state.loading && 'error' in state && <p role="alert" className={styles.error}>{state.error}</p>}
      {!state.loading && 'data' in state && (
        <>
          {state.data.suggestions.length === 0 && (
            <p role="status" data-testid="no-substitutes">
              No safe substitute found for {line.name}.
              {state.data.withheld > 0 ? ' Suggestions that clash with your household exclusions were left out.' : ''}
            </p>
          )}
          <ul className={styles.subList}>
            {state.data.suggestions.map((s) => (
              <li key={s.substitute} data-testid="substitute">
                <strong>{s.substitute}</strong>
                <span className={styles.subLine}>{s.quantityGuidance}</span>
                <span className={styles.subEffect}>{s.effect}</span>
                <span className={styles.subActions}>
                  {onApply && <Button size="sm" onClick={() => { onApply(toSwap(s)); onClose(); }}>Use for this cook</Button>}
                  {cookHref && <Link className="fr-btn fr-btn--secondary fr-btn--sm" href={cookHref(toSwap(s))}>Cook with this swap</Link>}
                  <Button size="sm" variant="secondary" loading={busy === s.substitute} onClick={() => void saveVariant(toSwap(s))}>Save as variant</Button>
                </span>
              </li>
            ))}
          </ul>
          {state.data.withheld > 0 && state.data.suggestions.length > 0 && (
            <p className="fr-muted" data-testid="withheld-note">
              {state.data.withheld} other suggestion{state.data.withheld === 1 ? ' was' : 's were'} left out because of your household exclusions
              {state.data.withheldUnverifiable > 0 ? ` (${state.data.withheldUnverifiable} could not be checked)` : ''}.
            </p>
          )}
          <p className="fr-muted">Suggestions are from AI and checked against your household exclusions, but always read the pack. The original recipe is never changed.</p>
        </>
      )}
      {saveError && <p role="alert" className={styles.error}>{saveError}</p>}
      {saved && (
        <p role="status" data-testid="variant-saved">
          Saved as <Link href={`/recipes/${saved.id}`}>{saved.title}</Link>. The original is unchanged.
        </p>
      )}
    </section>
  );
}
