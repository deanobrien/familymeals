'use client';

import { useRef, useState } from 'react';
import { Button } from '@fr/ui';
import type { IngredientCandidate } from '../../../lib/recipes/link-types';
import { searchIngredientsAction } from '../actions';
import styles from '../recipes.module.css';

/** What the form knows about one line's link. `ingredientId`: string = linked, null = "not in list", undefined = auto. */
export interface LinkState {
  ingredientId: string | null | undefined;
  /** Display name of the linked ingredient. */
  linkedName?: string | undefined;
  /** Set by the live preview when an unlinked name had several matches or near-misses. */
  ambiguous: boolean;
  candidates: IngredientCandidate[];
  /** The preview has not looked at this name yet. */
  checked: boolean;
}

export const UNCHECKED: LinkState = { ingredientId: undefined, ambiguous: false, candidates: [], checked: false };

function summary(s: LinkState, hasName: boolean): string {
  if (!hasName) return 'Matched to: (enter a name)';
  if (s.ingredientId) return `Matched to: ${s.linkedName ?? 'ingredient'}`;
  if (s.ingredientId === null) return 'Not in the ingredient list';
  if (!s.checked) return 'Matching...';
  if (s.candidates.length > 0) return `Pick a match (${s.candidates.length} ${s.ambiguous ? 'possible' : 'suggested'})`;
  return 'Not matched yet';
}

/** Inline "Matched to: X" control with candidates, catalogue search, and "not in list" (D222). */
export function IngredientLinkControl({
  n,
  hasName,
  state,
  onChoose,
  onAuto,
}: {
  n: number;
  hasName: boolean;
  state: LinkState;
  /** A catalogue ingredient, or null for "not in list". */
  onChoose: (choice: IngredientCandidate | null) => void;
  /** Go back to automatic matching of the typed name. */
  onAuto: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<IngredientCandidate[]>([]);
  const seq = useRef(0);

  const search = async (q: string) => {
    setQuery(q);
    const mine = ++seq.current;
    if (q.trim().length < 2) return setResults([]);
    const found = await searchIngredientsAction(q);
    if (mine === seq.current) setResults(found);
  };
  const pick = (c: IngredientCandidate | null) => {
    onChoose(c);
    setOpen(false);
    setQuery('');
    setResults([]);
  };

  const options = state.candidates.filter((c) => c.id !== state.ingredientId);
  const tone = state.ingredientId ? styles.linkOk : state.candidates.length > 0 && state.ingredientId === undefined ? styles.linkWarn : styles.linkMuted;

  return (
    <div className={styles.linkControl}>
      <Button
        variant="ghost"
        size="sm"
        className={tone}
        aria-expanded={open}
        aria-label={`Ingredient ${n} match: ${summary(state, hasName)}`}
        data-testid={`ing-link-${n}`}
        disabled={!hasName}
        onClick={() => setOpen((o) => !o)}
      >
        {summary(state, hasName)} <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </Button>
      {open && (
        <div className={styles.linkPanel} role="group" aria-label={`Ingredient ${n} match options`} data-testid={`ing-link-panel-${n}`}>
          {options.length > 0 && (
            <div>
              <p className={styles.linkHeading}>{state.ambiguous ? 'Several ingredients fit' : 'Did you mean'}</p>
              <ul className={styles.linkList}>
                {options.map((c) => (
                  <li key={c.id}>
                    <Button variant="secondary" size="sm" data-testid="ing-link-option" onClick={() => pick(c)}>{c.name}</Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <label className={styles.linkSearch}>
            <span>Search the ingredient list</span>
            <input
              type="search"
              className="fr-input"
              value={query}
              data-testid="ing-link-search"
              placeholder="e.g. coriander"
              onChange={(e) => void search(e.target.value)}
            />
          </label>
          {results.length > 0 && (
            <ul className={styles.linkList} aria-label="Search results">
              {results.map((c) => (
                <li key={c.id}>
                  <Button variant="secondary" size="sm" data-testid="ing-link-result" onClick={() => pick(c)}>{c.name}</Button>
                </li>
              ))}
            </ul>
          )}
          {query.trim().length >= 2 && results.length === 0 && <p className="fr-muted">No ingredient found.</p>}
          <div className={styles.rowTools}>
            <Button variant="ghost" size="sm" data-testid="ing-link-none" onClick={() => pick(null)}>Not in list</Button>
            <Button variant="ghost" size="sm" data-testid="ing-link-auto" onClick={() => { onAuto(); setOpen(false); }}>Match automatically</Button>
          </div>
          <p className="fr-muted">Unlinked ingredients are left out of cost and nutrition and are treated as unknown when planning around allergies.</p>
        </div>
      )}
    </div>
  );
}
