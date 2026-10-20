'use client';

// "What can I make now?" (P1-B, D375): ranked recipes from pantry stock, on Home (compact) and Pantry (full).
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, CardBody, useToast } from '@fr/ui';
import type { MakeNowView } from '../lib/make-now/types';
import { addMissingToListAction, getMakeNowAction } from '../lib/server/make-now/actions';
import { consentNoticeText, CONSENT_REVIEW_HREF } from '../lib/consent/notice';
import { SHOPPING_CHANGED_EVENT } from './restock-banner';

export function MakeNow({ limit = 5, heading = 'What can I make now?', headingLevel = 2 }: { limit?: number; heading?: string; headingLevel?: 2 | 3 }) {
  const { toast } = useToast();
  const [view, setView] = useState<MakeNowView | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => { getMakeNowAction(limit).then(setView, () => setView(null)); }, [limit]);
  useEffect(load, [load]);

  const H = headingLevel === 2 ? 'h2' : 'h3';
  const consent = view ? consentNoticeText(view.withheldExclusions) : null;

  async function addMissing(recipeId: string) {
    setBusy(recipeId);
    try {
      const res = await addMissingToListAction(recipeId);
      if (res.ok) {
        toast(res.message);
        window.dispatchEvent(new Event(SHOPPING_CHANGED_EVENT));
      } else toast({ message: res.error, tone: 'error' });
    } catch {
      toast({ message: 'Something went wrong. Please try again.', tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="make-now-h" data-testid="make-now" style={{ display: 'grid', gap: '0.75rem', marginBlock: '1.25rem' }}>
      <H id="make-now-h">{heading}</H>
      {view === undefined && <p className="fr-muted" role="status">Looking at your pantry&hellip;</p>}
      {view === null && <p className="fr-muted">We could not load suggestions just now.</p>}
      {consent && (
        <p role="status" data-testid="make-now-consent" className="fr-muted" style={{ margin: 0 }}>
          {consent} &mdash; <Link href={CONSENT_REVIEW_HREF}>review in Settings</Link>.
        </p>
      )}
      {view && view.items.length === 0 && (
        <p className="fr-muted" data-testid="make-now-empty">
          {view.pantryEmpty ? 'Add some stock to your pantry and we will suggest what you can cook.' : 'Nothing in your library is close to what you have in right now.'}
          {view.hiddenByAllergy > 0 && ` ${view.hiddenByAllergy} recipe${view.hiddenByAllergy === 1 ? ' was' : 's were'} left out because of your household's allergy list.`}
        </p>
      )}
      {view && view.items.length > 0 && (
        <ol aria-label="Recipes you can make" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.75rem' }}>
          {view.items.map((r) => (
            <li key={r.recipeId} data-testid="make-now-item">
              <Card>
                <CardBody>
                  <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between' }}>
                    <Link href={r.href} style={{ fontWeight: 600 }}>{r.title}</Link>
                    <span style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                      <Badge tone={r.makeable ? 'success' : r.coveragePct >= 70 ? 'neutral' : 'warning'}>{r.makeable ? 'Ready to cook' : `${r.coveragePct}% covered`}</Badge>
                      {r.usesExpiring && <Badge tone="warning">Uses expiring stock</Badge>}
                    </span>
                  </div>
                  <p className="fr-muted" style={{ margin: '0.25rem 0 0' }}>{r.headline}</p>
                  {r.missing.length > 0 && (
                    <>
                      <p style={{ margin: '0.4rem 0 0' }} data-testid="make-now-missing">
                        Still needed: {r.missing.map((m) => (m.quantityLabel ? `${m.name} (${m.quantityLabel})` : m.name)).join(', ')}
                      </p>
                      <div style={{ marginTop: '0.5rem' }}>
                        <Button size="sm" variant="secondary" loading={busy === r.recipeId} aria-label={`Add missing items for ${r.title} to the shopping list`} onClick={() => void addMissing(r.recipeId)}>
                          Add missing to shopping list
                        </Button>
                      </div>
                    </>
                  )}
                </CardBody>
              </Card>
            </li>
          ))}
        </ol>
      )}
      {view && view.hiddenByAllergy > 0 && view.items.length > 0 && (
        <p className="fr-muted" data-testid="make-now-hidden" style={{ margin: 0 }}>
          {view.hiddenByAllergy} recipe{view.hiddenByAllergy === 1 ? '' : 's'} left out because of your household&rsquo;s allergy list.
        </p>
      )}
    </section>
  );
}
