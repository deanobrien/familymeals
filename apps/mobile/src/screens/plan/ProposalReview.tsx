import React from 'react';
import { View } from 'react-native';
import type { IdeaExtra, PlanClient } from '@/lib/planApi';
import { dateShort, dayShort } from '@/lib/plan/dates';
import { formatPence } from '@/lib/plan/ops';
import { MEAL_LABEL, type Proposal, type RecipeLite } from '@/lib/plan/types';
import { Button, Muted, Text } from '../ui';
import IdeasList from './IdeasList';
import { Section } from './parts';

export function proposalCostLabel(p: Pick<Proposal, 'totalCostPence' | 'uncostedMeals'>): string {
  if (p.totalCostPence == null) return 'Uncosted: no price data for these recipes.';
  const n = p.uncostedMeals.length;
  return n > 0 ? `At least ${formatPence(p.totalCostPence)} (estimate); ${n} meal${n === 1 ? '' : 's'} uncosted.` : `About ${formatPence(p.totalCostPence)} (estimate).`;
}

/** The solver's proposal: meals, the constraint report, what could not be met, re-imposed safety exclusions and gaps. */
export default function ProposalReview({
  proposal, recipes, client, extra, accepted, onAccept, onDiscard,
}: {
  proposal: Proposal; recipes: ReadonlyMap<string, RecipeLite>; client: PlanClient; extra: IdeaExtra; accepted: boolean; onAccept: () => void; onDiscard: () => void;
}) {
  const p = proposal;
  return (
    <View testID="proposal">
      <Text style={{ fontWeight: '700', fontSize: 18 }} accessibilityRole="header">Proposed plan</Text>
      <Muted>Nothing is saved yet. Review it, accept it into the week, then approve.</Muted>
      <Text testID="proposal-cost">{`Estimated cost: ${proposalCostLabel(p)}`}</Text>

      <Section title="Proposed meals">
        {p.slots.map((s) => (
          <View key={`${s.date}|${s.mealType}`} testID="proposal-slot" style={{ marginBottom: 6 }}>
            <Text style={{ fontWeight: '600' }}>{`${dayShort(s.date)} ${dateShort(s.date)} · ${MEAL_LABEL[s.mealType]}`}</Text>
            <Text>{s.recipeId ? `${recipes.get(s.recipeId)?.title ?? s.recipeId} · ${s.servings} servings` : 'Needs a new recipe'}</Text>
            {s.note ? <Muted>{s.note}</Muted> : null}
          </View>
        ))}
      </Section>

      {p.reimposedExclusions.length > 0 ? (
        <Section title="Excluded for safety" testID="reimposed">
          <Text>{`Also excluded for safety: ${p.reimposedExclusions.join(', ')}. These come from your household profile and were not in your request, so we added them back.`}</Text>
        </Section>
      ) : null}

      {p.report.length > 0 ? (
        <Section title="Constraint check" testID="report">
          {p.report.map((r) => (
            <View key={r.constraint} style={{ marginBottom: 4 }} accessible accessibilityLabel={`${r.constraint}: ${r.met ? 'met' : 'not met'}. ${r.detail}`}>
              <Text style={{ fontWeight: '600' }}>{`${r.constraint}: ${r.met ? 'Met' : 'Not met'}`}</Text>
              <Muted>{r.detail}</Muted>
            </View>
          ))}
        </Section>
      ) : null}

      {p.unmet.length > 0 ? (
        <Section title="What could not be met" testID="unmet">{p.unmet.map((u) => <Text key={u.detail}>{`- ${u.detail}`}</Text>)}</Section>
      ) : null}
      {p.explanations.length > 0 ? (
        <Section title="Notes">{p.explanations.map((x) => <Muted key={x}>{`- ${x}`}</Muted>)}</Section>
      ) : null}
      {p.gaps.length > 0 ? (
        <Section title="Gaps needing a new recipe" testID="gaps">
          {p.gaps.map((g) => <Text key={`${g.date}|${g.mealType}`}>{`- ${dayShort(g.date)} ${MEAL_LABEL[g.mealType]}: ${g.reason}`}</Text>)}
        </Section>
      ) : null}

      <IdeasList client={client} needs={p.ideas} extra={extra} />

      <Button title={accepted ? 'Accepted into the week' : 'Accept into week'} disabled={accepted} onPress={onAccept} testID="accept-proposal" />
      <Button title="Discard" variant="secondary" onPress={onDiscard} testID="discard-proposal" />
      {accepted ? <Muted>The meals are now in the week above and still unsaved. Approve the plan when you are happy with it. Accepting replaces any meals already in this week.</Muted> : null}
    </View>
  );
}
