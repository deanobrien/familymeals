'use client';

import { useState, useTransition } from 'react';
import type { PlanRequest } from '@fr/domain';
import type { ParsedPlanRequest, PlanProposal } from '@fr/plan-orchestrator';
import { Badge, Button, Input, Textarea } from '@fr/ui';
import { dateShort, dayShort } from '../../lib/plan/dates';
import { formatPence } from '../../lib/plan/cost';
import { slotKey } from '../../lib/plan/ops';
import { DIET_CATEGORIES, proportionsSentence, roundProportions, type Proportions } from '../../lib/plan/proportions';
import { MEAL_LABEL, MEAL_TYPES, type MealType, type ParseResult, type PlanDoc, type PlanEntry, type ProposeResult, type RecipeLite } from '../../lib/plan/types';
import { ConstraintChips } from './constraint-chips';
import { parsePlanRequestAction, solvePlanRequestAction } from './actions';

interface Props {
  weekStart: string;
  recipes: ReadonlyMap<string, RecipeLite>;
  examplePrompt: string;
  exclusions: string[];
  /** Household member display names (choices for the favourites chip). */
  memberNames: string[];
  /** Receives an updater so the parent applies the proposal to its latest doc (and marks it unsaved). */
  onAccept: (next: (doc: PlanDoc) => PlanDoc) => void;
}

export function proposalToDoc(p: PlanProposal, doc: PlanDoc): PlanDoc {
  const entries: Record<string, PlanEntry> = {};
  for (const s of p.slots) {
    if (s.recipeId) entries[slotKey({ date: s.date, mealType: s.mealType as MealType })] = { kind: 'recipe', recipeId: s.recipeId, servings: s.servings, ...(s.note ? { note: s.note } : {}) };
  }
  return {
    ...doc,
    entries,
    mealTypes: MEAL_TYPES.filter((m) => p.constraints.mealTypes.includes(m)),
    budgetPence: p.constraints.budgetPence,
    prompt: p.prompt,
    proposalId: p.id,
    status: 'draft',
  };
}

export function PromptPanel({ weekStart, recipes, examplePrompt, exclusions, memberNames, onAccept }: Props) {
  const [prompt, setPrompt] = useState(examplePrompt);
  const [result, setResult] = useState<ProposeResult | null>(null);
  const [parseError, setParseError] = useState<(ParseResult & { ok: false }) | null>(null);
  const [parsed, setParsed] = useState<ParsedPlanRequest | null>(null);
  const [request, setRequest] = useState<PlanRequest | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [props, setProps] = useState<Proportions>({});
  const [pending, start] = useTransition();

  // Step 1: the only AI call. Reads the prompt into editable chips; nothing is solved yet.
  const understand = () =>
    start(async () => {
      setAccepted(false);
      setResult(null);
      setParseError(null);
      const r = await parsePlanRequestAction(prompt, weekStart);
      if (r.ok) { setParsed(r.parsed); setRequest(r.parsed.request); } else { setParsed(null); setRequest(null); setParseError(r); }
    });

  // Step 2: solve the (possibly edited) chips. No AI call, so editing and re-planning is free and instant.
  const propose = () =>
    start(async () => {
      if (!request) return;
      setAccepted(false);
      setResult(await solvePlanRequestAction(prompt, weekStart, request));
    });

  const rounded = roundProportions(props, 7);
  const anyProps = DIET_CATEGORIES.some((c) => (props[c] ?? 0) > 0);

  return (
    <section className="plan__panel" aria-label="Plan from a prompt">
      <h2>Plan from a prompt</h2>
      <Textarea
        label="Describe the week you want"
        hint="Allergies and strict exclusions in your household profile are always applied, whatever you type."
        rows={4}
        value={prompt}
        maxLength={1500}
        onChange={(e) => setPrompt(e.target.value)}
      />

      <details>
        <summary>Diet proportions</summary>
        <div className="plan__panel">
          <div className="plan__props">
            {DIET_CATEGORIES.map((c) => (
              <Input
                key={c}
                type="number"
                min={0}
                max={100}
                label={`${c[0]!.toUpperCase()}${c.slice(1)} %`}
                value={props[c] == null ? '' : String(Math.round((props[c] ?? 0) * 100))}
                onChange={(e) => setProps((p) => ({ ...p, [c]: e.target.value === '' ? undefined : Math.min(100, Math.max(0, Number(e.target.value))) / 100 }))}
              />
            ))}
          </div>
          {anyProps && (
            <div data-testid="proportion-explanation">
              <p className="plan__muted">
                Over 7 days: {DIET_CATEGORIES.filter((c) => rounded.counts[c] > 0).map((c) => `${rounded.counts[c]} ${c}`).join(', ')}.
              </p>
              <ul>{rounded.explanations.map((x) => <li key={x} className="plan__muted">{x}</li>)}</ul>
            </div>
          )}
          {!anyProps && <p className="plan__muted">Set shares such as 50% vegetarian and 30% fish. A week has 7 meals per slot, so shares are rounded to whole meals.</p>}
          <div>
            <Button variant="secondary" disabled={!anyProps} onClick={() => setPrompt((t) => `${t.trim()} ${proportionsSentence(props)}`.trim())}>Add to prompt</Button>
          </div>
        </div>
      </details>

      <div>
        <Button onClick={understand} loading={pending} disabled={!prompt.trim()} variant={request ? 'secondary' : 'primary'}>{request ? 'Read my request again' : 'Understand my request'}</Button>
      </div>

      {parseError && (
        <div className="plan__msg plan__msg--error" role="alert" data-testid="parse-error">{parseError.message}</div>
      )}

      {request && parsed && (
        <>
          <ConstraintChips
            request={request}
            onChange={setRequest}
            locked={parsed.householdExclusions}
            memberNames={memberNames}
            notes={parsed.unmet.map((u) => u.detail)}
          />
          <div>
            <Button onClick={propose} loading={pending}>{result?.ok ? 'Re-plan with these settings' : 'Propose a plan'}</Button>
          </div>
        </>
      )}

      {result && !result.ok && (
        <div className="plan__msg plan__msg--error" role="alert" data-testid="proposal-error">
          {result.message}
          {result.unmet && result.unmet.length > 0 && <ul>{result.unmet.map((u) => <li key={u.detail}>{u.detail}</li>)}</ul>}
          {result.gaps && result.gaps.length > 0 && <p className="plan__muted">{result.gaps.length} slot{result.gaps.length === 1 ? '' : 's'} would need a new recipe.</p>}
        </div>
      )}

      {result?.ok && (
        <Proposal
          p={result.proposal}
          recipes={recipes}
          accepted={accepted}
          onAccept={() => { onAccept((d) => proposalToDoc(result.proposal, d)); setAccepted(true); }}
          onDiscard={() => setResult(null)}
        />
      )}
      {exclusions.length > 0 && <p className="plan__muted">Always excluded for your household: {exclusions.join(', ')}.</p>}
    </section>
  );
}

function Proposal({ p, recipes, accepted, onAccept, onDiscard }: { p: PlanProposal; recipes: ReadonlyMap<string, RecipeLite>; accepted: boolean; onAccept: () => void; onDiscard: () => void }) {
  const cost =
    p.totalCostPence == null
      ? 'Uncosted: no price data for these recipes.'
      : p.uncostedMeals.length
        ? `At least ${formatPence(p.totalCostPence)} (estimate); ${p.uncostedMeals.length} meal${p.uncostedMeals.length === 1 ? '' : 's'} uncosted.`
        : `About ${formatPence(p.totalCostPence)} (estimate).`;
  return (
    <div className="plan__proposal" data-testid="proposal">
      <h3>Proposed plan</h3>
      <p className="plan__muted">Nothing is saved yet. Review it, accept it into the grid, then approve.</p>
      <p className="plan__cost">Estimated cost: {cost}</p>

      <ul className="plan__list" aria-label="Proposed meals">
        {p.slots.map((s) => (
          <li key={`${s.date}|${s.mealType}`} className="plan__row" data-testid="proposal-slot">
            <span className="plan__row-main">
              <strong>{dayShort(s.date)} {dateShort(s.date)} · {MEAL_LABEL[s.mealType as MealType]}</strong>
              <span>{s.recipeId ? recipes.get(s.recipeId)?.title ?? s.recipeId : 'Needs a new recipe'}{s.recipeId ? ` · ${s.servings} servings` : ''}</span>
              {s.note && <span className="plan__muted">{s.note}</span>}
            </span>
          </li>
        ))}
      </ul>

      {p.reimposedExclusions.length > 0 && (
        <div className="plan__msg" data-testid="reimposed">
          Also excluded for safety: {p.reimposedExclusions.join(', ')}. These come from your household profile and were not in your request, so we added them back.
        </div>
      )}

      <div>
        <h4>Constraint check</h4>
        <ul className="plan__list">
          {p.report.map((r) => (
            <li key={r.constraint} className="plan__row">
              <span className="plan__row-main"><strong>{r.constraint}</strong><span className="plan__muted">{r.detail}</span></span>
              <Badge tone={r.met ? 'success' : 'warning'}>{r.met ? 'Met' : 'Not met'}</Badge>
            </li>
          ))}
        </ul>
      </div>

      {p.unmet.length > 0 && (
        <div data-testid="unmet">
          <h4>What could not be met</h4>
          <ul>{p.unmet.map((u) => <li key={u.detail}>{u.detail}</li>)}</ul>
        </div>
      )}
      {p.explanations.length > 0 && (
        <div>
          <h4>Notes</h4>
          <ul>{p.explanations.map((x) => <li key={x} className="plan__muted">{x}</li>)}</ul>
        </div>
      )}
      {p.gaps.length > 0 && (
        <div data-testid="gaps">
          <h4>Gaps needing a new recipe</h4>
          <ul>{p.gaps.map((g) => <li key={`${g.date}|${g.mealType}`}>{dayShort(g.date)} {MEAL_LABEL[g.mealType as MealType]}: {g.reason}</li>)}</ul>
        </div>
      )}

      <div className="plan__inline">
        <Button onClick={onAccept} disabled={accepted}>{accepted ? 'Accepted into the grid' : 'Accept into grid'}</Button>
        <Button variant="ghost" onClick={onDiscard}>Discard</Button>
      </div>
      {accepted && <p className="plan__muted">The meals are now in the weekly grid above and still unsaved. Approve the plan when you are happy with it. Accepting replaces any meals already in this week.</p>}
    </div>
  );
}
