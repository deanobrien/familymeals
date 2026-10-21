'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Badge, Button } from '@fr/ui';
import { GOAL_DEFS, type GoalProgress, type GoalStatus } from '@fr/engine/nutrition';
import type { WeekGoals } from '../../lib/plan/goals';

const STATUS_TEXT: Record<GoalStatus, string> = { met: 'In line', close: 'Close', off: 'Some way off', unclear: 'Not enough data to say', none: 'No meals yet' };
const STATUS_TONE: Record<GoalStatus, 'success' | 'warning' | 'neutral'> = { met: 'success', close: 'warning', off: 'warning', unclear: 'neutral', none: 'neutral' };

/**
 * My goals this week (P3-B, D433). Only the signed-in person's own goals, and only when they have consented. An estimate
 * from planned (or cooked) recipes and their usual portion; "at least" when some data is missing; gentle hints only,
 * never advice. The page renders nothing without consent.
 */
export function WeekGoalsPanel({ planned, cooked }: { planned: WeekGoals | null; cooked?: WeekGoals | null }) {
  const [view, setView] = useState<'planned' | 'cooked'>('planned');
  const base = planned ?? cooked;
  if (!base) return null;
  const data = view === 'cooked' ? cooked ?? null : planned;
  const s = data?.summary;
  return (
    <section className="plan__nutrition" aria-labelledby="week-goals-h" data-testid="week-goals">
      <h2 id="week-goals-h">My goals this week</h2>
      {cooked !== undefined && (
        <div role="group" aria-label="Which meals" style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <Button size="sm" variant={view === 'planned' ? 'primary' : 'secondary'} aria-pressed={view === 'planned'} onClick={() => setView('planned')}>Planned</Button>
          <Button size="sm" variant={view === 'cooked' ? 'primary' : 'secondary'} aria-pressed={view === 'cooked'} onClick={() => setView('cooked')}>Cooked</Button>
        </div>
      )}
      {!data || !s ? (
        <p className="plan__muted" data-testid="week-goals-empty">{view === 'cooked' ? 'Nothing cooked this week yet.' : 'Plan some recipe meals to see this.'}</p>
      ) : (
        <>
          <p className="plan__muted">Only you can see this. Worked out for your usual portion ({s.portionShare === 1 ? 'one serving' : `${s.portionShare} of a serving`} of each meal). Change goals in <Link href="/settings#h-goals-section">Settings</Link>.</p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.75rem' }}>
            {s.progress.map((p) => <GoalRow key={p.goal} p={p} />)}
          </ul>
          {data.hints.length > 0 && (
            <ul data-testid="goal-hints" style={{ margin: '0.75rem 0 0' }}>
              {data.hints.map((h) => <li key={h.goal}>{h.text}</li>)}
            </ul>
          )}
          <p className="plan__muted">{s.shareNote}</p>
        </>
      )}
      <p className="plan__muted" data-testid="week-goals-disclaimer">{base.summary.disclaimer}</p>
    </section>
  );
}

function GoalRow({ p }: { p: GoalProgress }) {
  const def = GOAL_DEFS[p.goal];
  return (
    <li data-testid={`goal-progress-${p.goal}`} data-status={p.status}>
      <strong>{p.label}</strong>{' '}
      <Badge tone={STATUS_TONE[p.status]}>{STATUS_TEXT[p.status]}</Badge>
      <p style={{ margin: '0.25rem 0 0' }} data-testid={`goal-headline-${p.goal}`}>{p.headline}</p>
      <p className="plan__muted" style={{ margin: 0 }}>{p.detail}{p.caveat ? ` ${p.caveat}` : ''}</p>
      <p className="plan__muted" style={{ margin: 0 }}>
        {def.referenceText}{' '}
        <a href={def.source.url} target="_blank" rel="noreferrer noopener">{def.source.publisher}</a> (reviewed {def.source.reviewed}).
      </p>
    </li>
  );
}
