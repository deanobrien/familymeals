'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, Checkbox, ConfirmDialog, Select, useToast } from '@fr/ui';
import { GOAL_DEFS, GOAL_IDS, GOALS_CONSENT, GOALS_DISCLAIMER, PORTION_SHARES, type GoalId } from '@fr/engine/nutrition';
import s from '../../lib/dashboard/dashboard.module.css';
import type { GoalsState } from '../../lib/server/goals/types';
import { saveGoalsAction, withdrawGoalsAction } from './goals-actions';

/**
 * Health goals (P3-B, D430-D439). Optional, off by default, and behind its own explicit consent because it is
 * health-related data. Only you can see your goals. Reference values are NHS guidance for adults, each with its page and
 * review date. No calorie, weight or medical targets, and no goals for children. Never sent to an AI provider.
 */
export function GoalsSection({ initial, readOnly }: { initial: GoalsState | null; readOnly: boolean }) {
  const toast = useToast();
  const router = useRouter();
  const [state, setState] = useState<GoalsState | null>(initial);
  const active = state?.consentActive ?? false;
  const [consent, setConsent] = useState(false);
  const [adult, setAdult] = useState(state?.adultConfirmed ?? false);
  const [goals, setGoals] = useState<GoalId[]>(state?.goals ?? []);
  const [portion, setPortion] = useState(String(state?.portionShare ?? 1));
  const [nudge, setNudge] = useState(state?.nudgePlan ?? false);
  const [error, setError] = useState<string | undefined>();
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [pending, start] = useTransition();

  const toggle = (id: GoalId) => setGoals((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  function save() {
    setError(undefined);
    start(async () => {
      const r = await saveGoalsAction({ consent: active || consent, adultConfirmed: adult, goals, portionShare: Number(portion), nudgePlan: nudge });
      if (r.ok) {
        setState(r.state);
        setGoals(r.state.goals);
        setConsent(false);
        toast.toast({ message: r.state.consentActive ? 'Goals saved' : 'Nothing was saved' });
        router.refresh();
      } else {
        setError(
          r.error === 'consent_required' ? 'Please tick the consent box to save goals.'
          : r.error === 'invalid_input' ? 'Please confirm you are 18 or over and choose a portion size.'
          : r.error === 'read_only' ? 'This household is read-only while it is waiting to be deleted.'
          : r.error === 'forbidden' ? 'Nutrition goals are not available for this profile.'
          : 'Something went wrong. Please try again.',
        );
      }
    });
  }

  function withdraw() {
    start(async () => {
      const r = await withdrawGoalsAction();
      if (r.ok) {
        setState(r.state);
        setGoals([]);
        setNudge(false);
        setAdult(false);
        setConsent(false);
        toast.toast({ message: 'Consent withdrawn and your goals deleted' });
        router.refresh();
      } else setError('Something went wrong. Please try again.');
    });
  }

  const canPick = active || consent;

  return (
    <Card>
      <section className={s.card} aria-labelledby="h-goals" data-testid="goals-section" id="h-goals-section">
        <h2 id="h-goals">Health goals (optional)</h2>
        <p className={s.muted}>
          Pick simple weekly goals and see how your planned meals compare with UK guidance. Off unless you turn it on. Only you can see this.
        </p>
        <fieldset className={s.fieldset} data-testid="goals-consent">
          <legend>{GOALS_CONSENT.title}</legend>
          {!active && GOALS_CONSENT.paragraphs.map((p) => <p key={p} style={{ margin: 0 }}>{p}</p>)}
          {active && <p className={s.muted} data-testid="goals-consent-on">Your consent is on file. You can withdraw it below at any time, which deletes your goals.</p>}
          {!active && (
            <>
              <Checkbox label={GOALS_CONSENT.checkbox} checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={readOnly} data-testid="goals-consent-box" />
              <Checkbox label={GOALS_CONSENT.adultCheckbox} checked={adult} onChange={(e) => setAdult(e.target.checked)} disabled={readOnly} data-testid="goals-adult-box" />
            </>
          )}
          <p className={s.muted}>See our <Link className={s.link} href="/privacy">privacy notice</Link>.</p>
        </fieldset>

        {canPick && (
          <>
            <fieldset className={s.fieldset} data-testid="goals-list">
              <legend>My weekly goals</legend>
              {GOAL_IDS.map((id) => {
                const d = GOAL_DEFS[id];
                return (
                  <div key={id} style={{ display: 'grid', gap: '0.125rem' }}>
                    <Checkbox label={d.label} checked={goals.includes(id)} onChange={() => toggle(id)} disabled={readOnly} data-testid={`goal-${id}`} />
                    <p className={s.muted} style={{ margin: '0 0 0.5rem 1.75rem' }}>
                      {d.referenceText}{' '}
                      <a href={d.source.url} target="_blank" rel="noreferrer noopener" data-testid={`goal-source-${id}`}>{d.source.publisher}: {d.source.title}</a>
                      {' '}(page reviewed {d.source.reviewed}).
                    </p>
                  </div>
                );
              })}
            </fieldset>
            <Select
              label="My usual portion"
              value={portion}
              onChange={(e) => setPortion(e.target.value)}
              options={PORTION_SHARES.map((p) => ({ value: String(p.value), label: p.label }))}
              hint="Used to scale each planned meal, which is worked out for one serving."
              disabled={readOnly}
            />
            <Checkbox label="Nudge meal plans towards my household’s goals" checked={nudge} onChange={(e) => setNudge(e.target.checked)} disabled={readOnly} data-testid="goal-nudge" />
            <p className={s.muted}>Off by default. When on, the planner gets an anonymous list of goals (never your name) and only prefers meals that fit them when everything else allows.</p>
            {!active && !adult && <p className={s.muted}>Confirm you are 18 or over above to save.</p>}
          </>
        )}

        {error && <p role="alert" style={{ margin: 0, color: 'var(--fr-danger)' }}>{error}</p>}
        <div className={s.row}>
          <Button onClick={save} disabled={pending || readOnly || (!active && !consent)} loading={pending} data-testid="goals-save">Save goals</Button>
          {active && <Button variant="secondary" onClick={() => setConfirmWithdraw(true)} disabled={pending} data-testid="goals-withdraw">Withdraw consent and delete my goals</Button>}
        </div>
        <p className={s.muted} data-testid="goals-disclaimer">{GOALS_DISCLAIMER}</p>
      </section>
      <ConfirmDialog
        open={confirmWithdraw}
        onOpenChange={setConfirmWithdraw}
        title="Withdraw consent?"
        description="This deletes your nutrition goals and portion choice. You can set them up again at any time."
        confirmLabel="Delete my goals"
        destructive
        onConfirm={withdraw}
      />
    </Card>
  );
}
