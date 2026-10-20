'use client';

import { useState } from 'react';
import { Badge, Button } from '@fr/ui';
import type { WeekVariety } from '../../lib/plan/variety';

const KINDS = [['fish', 'Fish'], ['meat', 'Meat'], ['plant', 'Plant-based']] as const;

/**
 * "5 a day" and variety for the week (P1-B, D376). An estimate from the planned recipes' ingredient weights, 80 g portions,
 * one serving of each meal per person. Descriptive only: no targets are judged and no health claims are made.
 * `cooked` is supplied only once the cooking lane records cooked meals; until then there is no toggle.
 */
export function WeekVarietyPanel({ planned, cooked }: { planned: WeekVariety | null; cooked?: WeekVariety | null }) {
  const [view, setView] = useState<'planned' | 'cooked'>('planned');
  const data = view === 'cooked' ? cooked ?? null : planned;
  if (!planned && !cooked) return null;
  const s = data?.summary;
  return (
    <section className="plan__nutrition" aria-labelledby="week-var-h" data-testid="week-variety">
      <h2 id="week-var-h">Fruit, veg and variety</h2>
      {cooked !== undefined && (
        <div role="group" aria-label="Which meals" style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <Button size="sm" variant={view === 'planned' ? 'primary' : 'secondary'} aria-pressed={view === 'planned'} onClick={() => setView('planned')}>Planned</Button>
          <Button size="sm" variant={view === 'cooked' ? 'primary' : 'secondary'} aria-pressed={view === 'cooked'} onClick={() => setView('cooked')}>Cooked</Button>
        </div>
      )}
      {!data || !s ? (
        <p className="plan__muted" data-testid="week-variety-empty">{view === 'cooked' ? 'Nothing cooked this week yet.' : 'Plan some recipe meals to see this.'}</p>
      ) : (
        <>
          <p className="plan__muted" data-testid="week-variety-summary">
            Variety score <strong data-testid="variety-score">{s.score}</strong> out of 100 (a rough estimate, not a health score).{' '}
            About <strong data-testid="variety-avg">{s.avgPortionsPerDay}</strong> fruit and veg portions per person per {view === 'cooked' ? 'cooked' : 'planned'} day;{' '}
            {s.daysWithFive} of {s.dayCount} {s.dayCount === 1 ? 'day' : 'days'} reach 5.
            {s.mealsWithoutData > 0 && ` ${s.mealsWithoutData} ${s.mealsWithoutData === 1 ? 'meal has' : 'meals have'} no ingredient data, so figures are lower bounds.`}
            {s.mealsWithoutData === 0 && s.mealsPartlyWeighed > 0 && ` ${s.mealsPartlyWeighed} ${s.mealsPartlyWeighed === 1 ? 'meal has' : 'meals have'} ingredients we could not weigh, so figures are lower bounds.`}
          </p>
          <div className="fr-table__wrap">
            <table className="fr-table">
              <caption>Estimated fruit and veg portions per person, by day</caption>
              <thead><tr><th scope="col">Day</th><th scope="col" className="fr-num">Portions</th></tr></thead>
              <tbody>
                {s.days.map((d) => (
                  <tr key={d.date}>
                    <th scope="row">{d.date}</th>
                    <td className="fr-num">{d.portions} {d.portions >= 5 && <Badge tone="success">5+</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>Protein variety</h3>
          <ul data-testid="variety-protein" style={{ margin: 0 }}>
            {KINDS.map(([k, label]) => <li key={k}>{label}: {s.proteinMeals[k]} {s.proteinMeals[k] === 1 ? 'meal' : 'meals'}</li>)}
          </ul>
          <p className="plan__muted">{s.proteinSources.length} different protein ingredients{s.proteinSources.length ? `: ${s.proteinSources.join(', ')}` : ''}.</p>
          <h3>Plant variety</h3>
          <p className="plan__muted" data-testid="variety-plants">
            {s.plants.length} different plants{s.plants.length ? `: ${s.plants.join(', ')}` : ''}.
          </p>
        </>
      )}
      <p className="plan__muted" data-testid="week-variety-disclaimer">{(s ?? planned?.summary ?? cooked?.summary)?.disclaimer} Potatoes, juice, garlic, ginger, chilli and herbs are not counted as portions; pulses count at most once a day.</p>
    </section>
  );
}
