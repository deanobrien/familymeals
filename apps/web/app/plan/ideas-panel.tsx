'use client';

import { useState, useTransition } from 'react';
import type { RecipeIdeaNeed } from '@fr/plan-orchestrator';
import { Button } from '@fr/ui';
import { findIdeasAction } from '../recipes/discover/actions';
import { IdeaResults, type DiscoverResultState } from '../recipes/discover/idea-results';

export interface IdeaExtra { terms: string[]; allergens: string[]; excludeDiets: Array<'meat' | 'fish' | 'vegetarian' | 'vegan'> }

/**
 * "Find ideas" for planner shortfalls (D175). The server re-applies the household's hard exclusions; what is sent
 * here can only ADD exclusions. Previewing or saving a recipe never touches the plan: it goes to the library via the
 * review screen, and the user adds it to a week themselves.
 */
export function IdeasPanel({ needs, extra }: { needs: RecipeIdeaNeed[]; extra: IdeaExtra }) {
  const [results, setResults] = useState<Record<number, DiscoverResultState>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [, start] = useTransition();

  if (needs.length === 0) return null;
  const find = (i: number) => {
    setBusy(i);
    start(async () => {
      const r = await findIdeasAction({ criteria: needs[i]!.criteria, extra });
      setResults((prev) => ({ ...prev, [i]: r }));
      setBusy(null);
    });
  };

  return (
    <div data-testid="gap-ideas">
      <h4>Recipe ideas for the gaps</h4>
      <p className="plan__muted">Nothing is added to your plan. Pick a recipe to preview it, then save it to your library and add it to a week yourself.</p>
      <ul className="plan__list">
        {needs.map((n, i) => (
          <li key={`${n.reason}|${i}`} style={{ display: 'grid', gap: '0.5rem' }} data-testid="gap-idea-need">
            <span className="plan__row-main">
              <strong>{n.reason}</strong>
              {n.criteria.maxTotalMinutes && <span className="plan__muted">Aim for {n.criteria.maxTotalMinutes} minutes or less (the source does not give cooking times, so check the method).</span>}
            </span>
            <div><Button variant="secondary" onClick={() => find(i)} loading={busy === i}>Find ideas</Button></div>
            <IdeaResults result={results[i] ?? null} testId={`gap-idea-results-${i}`} />
          </li>
        ))}
      </ul>
    </div>
  );
}
