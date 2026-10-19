'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, Card, CardBody, Sheet } from '@fr/ui';
import type { DiscoverCard, DiscoverOutcome } from '../../../lib/server/discover/service';
import { draftFromSourceAction } from './actions';

export type DiscoverResultState = DiscoverOutcome | null;

const DIET_LABEL: Record<DiscoverCard['diet'], string> = { meat: 'Meat (or not checked)', fish: 'Fish', vegetarian: 'Vegetarian (unverified)', vegan: 'Vegan (unverified)' };

/** Cards + preview + "Save to my recipes" (-> the same review screen as photo import). Shared by /recipes/discover and the planner. */
export function IdeaResults({ result, testId = 'discover-results' }: { result: DiscoverResultState; testId?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState<DiscoverCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!result) return null;
  if (!result.ok) return <p role="alert" data-testid="discover-error" className="fr-muted">{result.message}</p>;

  const save = (id: string) =>
    start(async () => {
      setError(null);
      const r = await draftFromSourceAction(id);
      if (!r.ok) return setError(r.message);
      router.push(`/recipes/discover/review?u=${encodeURIComponent(r.uploadId)}`);
    });

  return (
    <div data-testid={testId} style={{ display: 'grid', gap: '1rem' }}>
      {result.cards.length === 0 && (
        <p role="status" data-testid="discover-empty">
          No recipes to show.{result.withheld > 0 ? '' : ' Try different words or another filter.'}
        </p>
      )}
      {result.withheld > 0 && (
        <p role="status" className="fr-muted" data-testid="discover-withheld">
          {result.withheld} recipe{result.withheld === 1 ? '' : 's'} hidden because {result.exclusionsActive ? 'they contain something your household excludes or an ingredient we cannot check against your exclusions' : 'of your filters'}
          {result.withheldUnverifiable > 0 ? ` (${result.withheldUnverifiable} only because they could not be checked)` : ''}.
        </p>
      )}
      {error && <p role="alert" data-testid="discover-save-error">{error}</p>}
      <ul style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fill, minmax(15rem, 1fr))', padding: 0, margin: 0, listStyle: 'none' }}>
        {result.cards.map((c) => (
          <li key={c.id} data-testid="discover-card" data-recipe-id={c.id}>
            <Card>
              <CardBody>
                <div style={{ display: 'grid', gap: '0.5rem' }}>
                  {c.imageUrl && (
                    <div style={{ aspectRatio: '4 / 3', overflow: 'hidden', borderRadius: 8, background: 'var(--fr-surface-2)' }}>
                      {/* Hotlinked from the publisher (not copied); CSP allows only their image host. */}
                      <img src={c.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                  )}
                  <h3 style={{ margin: 0 }}>{c.title}</h3>
                  <p className="fr-muted" style={{ margin: 0 }}>{[c.area, c.category].filter(Boolean).join(' · ')}</p>
                  <div><Badge data-testid="diet-badge">{DIET_LABEL[c.diet]}</Badge></div>
                  <p className="fr-muted" style={{ margin: 0, fontSize: '0.8125rem' }} data-testid="card-attribution">
                    Source: <a href={c.attribution.url} target="_blank" rel="noopener noreferrer">{c.attribution.publisher}</a>
                  </p>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <Button variant="secondary" onClick={() => setOpen(c)} aria-label={`Preview ${c.title}`}>Preview</Button>
                    <Button onClick={() => save(c.id)} loading={pending} aria-label={`Save ${c.title} to my recipes`}>Save to my recipes</Button>
                  </div>
                </div>
              </CardBody>
            </Card>
          </li>
        ))}
      </ul>
      <p className="fr-muted" style={{ fontSize: '0.8125rem' }}>Recipes and images from {result.sourceLabel || 'the recipe source'}. You review every recipe before it is saved.</p>

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)} title={open?.title ?? 'Recipe'} description={open ? [open.area, open.category].filter(Boolean).join(' · ') : undefined}>
        {open && (
          <div style={{ display: 'grid', gap: '0.75rem' }} data-testid="discover-preview">
            <p className="fr-muted" style={{ margin: 0 }}>Diet label: {DIET_LABEL[open.diet]}. {open.dietNote}. Check it yourself before relying on it.</p>
            <h4 style={{ margin: 0 }}>Ingredients</h4>
            <ul>{open.ingredients.map((i, n) => <li key={`${i.name}-${n}`}>{[i.measure, i.name].filter(Boolean).join(' ')}</li>)}</ul>
            <h4 style={{ margin: 0 }}>Method</h4>
            <ol>{open.steps.map((s, n) => <li key={n}>{s}</li>)}</ol>
            <p className="fr-muted" style={{ margin: 0 }}>
              Source: <a href={open.attribution.url} target="_blank" rel="noopener noreferrer">{open.attribution.publisher}</a>
              {open.youtubeUrl && <> · <a href={open.youtubeUrl} target="_blank" rel="noopener noreferrer">Video</a></>}
              {open.creativeCommons && <> · Image licence: {open.creativeCommons}</>}
            </p>
            <Button onClick={() => save(open.id)} loading={pending}>Save to my recipes</Button>
          </div>
        )}
      </Sheet>
    </div>
  );
}
