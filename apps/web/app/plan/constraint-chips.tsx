'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { PlanRequest } from '@fr/domain';
import { Button } from '@fr/ui';
import {
  DIETS, WEEKDAYS, WEEKDAY_LABEL, addFavourite, addTerm, describeTarget, quickWeekdays, removeAllergen, removeDietTarget, removeFavourite,
  removeTag, removeTerm, setBudgetPounds, setDays, setDietTarget, setQuickMinutes, setQuickStrict, setServings, toggleQuickDay,
  type Diet, type TargetKind,
} from '../../lib/plan/request-chips';

interface Props {
  request: PlanRequest;
  onChange: (next: PlanRequest) => void;
  /** Household hard exclusions: always applied, shown locked. */
  locked: string[];
  /** Soft dislikes per member (P1-B): shown read-only, avoided where possible, edited in Settings. */
  dislikes?: { memberName: string; terms: string[] }[];
  memberNames: string[];
  /** Messages about the request (unknown / ambiguous member names). */
  notes: string[];
}

function Chip({ label, onRemove, removeLabel, locked }: { label: string; onRemove?: () => void; removeLabel?: string; locked?: boolean }) {
  return (
    <li className={`plan__chip${locked ? ' plan__chip--locked' : ''}`} data-testid="constraint-chip">
      <span>{label}</span>
      {locked && <span className="plan__muted">locked</span>}
      {onRemove && (
        <button type="button" className="plan__chip-x" onClick={onRemove} aria-label={removeLabel ?? `Remove ${label}`}>×</button>
      )}
    </li>
  );
}

/** The AI's reading of the prompt as editable chips (D133). Edits only change the request; nothing is solved until the user says so. */
export function ConstraintChips({ request, onChange, locked, dislikes = [], memberNames, notes }: Props) {
  const [term, setTerm] = useState('');
  const [dietCat, setDietCat] = useState<Diet>('vegetarian');
  const [kind, setKind] = useState<TargetKind>('percent');
  const [amount, setAmount] = useState('50');
  const [member, setMember] = useState('');

  const diets = DIETS.flatMap((d) => (request.dietProportions?.[d] ? [[d, request.dietProportions[d]!] as const] : []));
  const days = new Set(quickWeekdays(request));
  const availableMembers = memberNames.filter((m) => !request.favouritesOf.some((f) => f.toLowerCase() === m.toLowerCase()));

  return (
    <div className="plan__chips" data-testid="constraint-chips" aria-label="What we understood from your request">
      <h3>What we understood</h3>
      <p className="plan__muted">Check these and fix anything we got wrong. Changing them does not call the AI again.</p>

      <div className="plan__chip-group">
        <label>Servings <input type="number" min={1} max={50} aria-label="Servings" value={request.servings} onChange={(e) => onChange(setServings(request, Number(e.target.value)))} /></label>
        <label>Days <input type="number" min={1} max={31} aria-label="Days" value={request.days ?? 7} onChange={(e) => onChange(setDays(request, Number(e.target.value)))} /></label>
        <label>Budget (£) <input type="number" min={0} step={1} aria-label="Budget in pounds" placeholder="none" value={request.budgetPence === undefined ? '' : String(request.budgetPence / 100)} onChange={(e) => onChange(setBudgetPounds(request, e.target.value === '' ? null : Number(e.target.value)))} /></label>
        <span className="plan__muted">Meals: {request.mealTypes.join(', ')}</span>
      </div>

      <section aria-label="Diet mix">
        <h4>Diet mix</h4>
        <ul className="plan__chiplist">
          {diets.length === 0 && <li className="plan__muted">No diet targets.</li>}
          {diets.map(([d, t]) => <Chip key={d} label={describeTarget(d, t)} onRemove={() => onChange(removeDietTarget(request, d))} removeLabel={`Remove diet target ${d}`} />)}
        </ul>
        <div className="plan__inline">
          <label>Diet <select aria-label="Diet" value={dietCat} onChange={(e) => setDietCat(e.target.value as Diet)}>{DIETS.map((d) => <option key={d} value={d}>{d}</option>)}</select></label>
          <label>Type <select aria-label="Target type" value={kind} onChange={(e) => setKind(e.target.value as TargetKind)}>
            <option value="percent">percent of meals</option><option value="count">exactly N meals</option><option value="min">at least N meals</option><option value="max">at most N meals</option>
          </select></label>
          <label>Amount <input type="number" min={0} aria-label="Target amount" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          <Button variant="secondary" size="sm" onClick={() => onChange(setDietTarget(request, dietCat, kind, Number(amount)))}>Set diet target</Button>
        </div>
      </section>

      {dislikes.length > 0 && (
        <section aria-label="Dislikes" data-testid="dislike-chips">
          <h4>Dislikes (soft)</h4>
          <ul className="plan__chiplist">
            {dislikes.flatMap((d) => d.terms.map((t) => <Chip key={`dis-${d.memberName}-${t}`} label={`${d.memberName}: ${t}`} />))}
          </ul>
          <p className="plan__muted">Avoided where possible, never a rule. This is a preference, not an allergy. Change it in <Link href="/settings#h-dislikes">Settings</Link>.</p>
        </section>
      )}

      <section aria-label="Exclusions">
        <h4>Exclusions</h4>
        <ul className="plan__chiplist">
          {locked.map((x) => <Chip key={`lock-${x}`} label={x} locked />)}
          {request.excludeTerms.map((x) => <Chip key={`t-${x}`} label={x} onRemove={() => onChange(removeTerm(request, x))} />)}
          {request.excludeAllergens.map((x) => <Chip key={`a-${x}`} label={`${x} (allergen)`} onRemove={() => onChange(removeAllergen(request, x))} removeLabel={`Remove allergen ${x}`} />)}
          {request.excludeDietCategories.length > 0 && <li className="plan__muted">No {request.excludeDietCategories.join(', ')} meals.</li>}
        </ul>
        <div className="plan__inline">
          <label>Avoid ingredient <input aria-label="Avoid ingredient" value={term} onChange={(e) => setTerm(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onChange(addTerm(request, term)); setTerm(''); } }} /></label>
          <Button variant="secondary" size="sm" disabled={!term.trim()} onClick={() => { onChange(addTerm(request, term)); setTerm(''); }}>Add exclusion</Button>
        </div>
      </section>

      <section aria-label="Quick meals">
        <h4>Quick meals</h4>
        <div className="plan__inline" role="group" aria-label="Quick meal days">
          {WEEKDAYS.map((d) => (
            <button key={d} type="button" className={`plan__day-toggle${days.has(d) ? ' is-on' : ''}`} aria-pressed={days.has(d)} onClick={() => onChange(toggleQuickDay(request, d))}>{WEEKDAY_LABEL[d]}</button>
          ))}
        </div>
        {request.quickMeals && (
          <div className="plan__inline">
            <label>Max minutes <input type="number" min={5} max={240} aria-label="Quick meal minutes" value={request.quickMeals.maxTotalMinutes} onChange={(e) => onChange(setQuickMinutes(request, Number(e.target.value)))} /></label>
            <label><input type="checkbox" checked={request.quickMeals.strict} onChange={(e) => onChange(setQuickStrict(request, e.target.checked))} /> Only quick meals on those days (strict)</label>
          </div>
        )}
      </section>

      <section aria-label="Favourites">
        <h4>Favourites of</h4>
        <ul className="plan__chiplist">
          {request.favouritesOf.length === 0 && <li className="plan__muted">Nobody&apos;s favourites.</li>}
          {request.favouritesOf.map((m) => <Chip key={m} label={`${m}'s favourites`} onRemove={() => onChange(removeFavourite(request, m))} removeLabel={`Remove favourites of ${m}`} />)}
        </ul>
        {availableMembers.length > 0 && (
          <div className="plan__inline">
            <label>Add favourites of <select aria-label="Add favourites of" value={member} onChange={(e) => setMember(e.target.value)}><option value="">Choose a member</option>{availableMembers.map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
            <Button variant="secondary" size="sm" disabled={!member} onClick={() => { onChange(addFavourite(request, member)); setMember(''); }}>Add</Button>
          </div>
        )}
      </section>

      {request.includeTags.length > 0 && (
        <section aria-label="Preferred tags">
          <h4>Preferred tags</h4>
          <ul className="plan__chiplist">{request.includeTags.map((t) => <Chip key={t} label={t} onRemove={() => onChange(removeTag(request, t))} />)}</ul>
        </section>
      )}

      {notes.length > 0 && <ul className="plan__msg" data-testid="chip-notes">{notes.map((n) => <li key={n}>{n}</li>)}</ul>}
    </div>
  );
}
