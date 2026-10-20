import React, { useState } from 'react';
import { View } from 'react-native';
import { describeError, type IdeaExtra, type PlanClient } from '@/lib/planApi';
import type { IdeaCard, IdeaNeed, IdeasResult } from '@/lib/plan/types';
import { Button, ErrorText, Muted, Text } from '../ui';
import { Section } from './parts';

const DIET_LABEL: Record<IdeaCard['diet'], string> = { meat: 'Meat (or not checked)', fish: 'Fish', vegetarian: 'Vegetarian (unverified)', vegan: 'Vegan (unverified)' };

/**
 * "Find ideas" for planner shortfalls (D175). The server re-applies the household's hard exclusions; what is sent here can
 * only ADD exclusions. Nothing is added to the plan: a saved idea goes to the library and the user plans it themselves.
 */
export default function IdeasList({ client, needs, extra }: { client: PlanClient; needs: IdeaNeed[]; extra: IdeaExtra }) {
  const [results, setResults] = useState<Record<number, IdeasResult>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<string, string>>({});

  if (needs.length === 0) return null;

  async function find(i: number) {
    setBusy(i);
    setError(null);
    try {
      const r = await client.findIdeas(needs[i]!, extra);
      setResults((prev) => ({ ...prev, [i]: r }));
    } catch (e) {
      setError(describeError(e).message);
    } finally {
      setBusy(null);
    }
  }

  async function save(card: IdeaCard) {
    setSaving(card.id);
    setError(null);
    try {
      const r = await client.saveIdea(card.id);
      setSaved((s) => ({ ...s, [card.id]: r.title }));
    } catch (e) {
      setError(describeError(e).message);
    } finally {
      setSaving(null);
    }
  }

  return (
    <Section title="Recipe ideas for the gaps" testID="gap-ideas">
      <Muted>Nothing is added to your plan. Preview a recipe, save it to your library, then add it to a week yourself.</Muted>
      <ErrorText message={error} />
      {needs.map((n, i) => (
        <View key={`${n.reason}|${i}`} testID="gap-idea-need" style={{ marginBottom: 8 }}>
          <Text style={{ fontWeight: '600' }}>{n.reason}</Text>
          {n.criteria.maxTotalMinutes ? <Muted>{`Aim for ${n.criteria.maxTotalMinutes} minutes or less (the source does not give cooking times, so check the method).`}</Muted> : null}
          <Button title="Find ideas" variant="secondary" disabled={busy === i} accessibilityLabel={`Find ideas: ${n.reason}`} onPress={() => void find(i)} testID={`find-ideas-${i}`} />
          {busy === i ? <Muted>Looking for ideas...</Muted> : null}
          {results[i] && results[i]!.cards.length === 0 ? <Muted testID={`ideas-empty-${i}`}>No recipes to show. Try again later.</Muted> : null}
          {results[i]?.cards.map((c) => (
            <View key={c.id} testID="idea-card" style={{ marginTop: 6 }}>
              <Text style={{ fontWeight: '600' }}>{c.title}</Text>
              <Muted>{[c.area, c.category, DIET_LABEL[c.diet]].filter(Boolean).join(' · ')}</Muted>
              <Button title={open === c.id ? 'Hide preview' : 'Preview'} variant="secondary" accessibilityLabel={`${open === c.id ? 'Hide preview of' : 'Preview'} ${c.title}`} onPress={() => setOpen(open === c.id ? null : c.id)} />
              {open === c.id ? (
                <View testID="idea-preview">
                  <Muted>{`Diet label: ${DIET_LABEL[c.diet]}. ${c.dietNote} Check it yourself before relying on it.`}</Muted>
                  {c.ingredients.map((ing, k) => <Muted key={`${ing.name}-${k}`}>{`- ${[ing.measure, ing.name].filter(Boolean).join(' ')}`}</Muted>)}
                  {c.steps.map((s, k) => <Muted key={k}>{`${k + 1}. ${s}`}</Muted>)}
                  {c.publisher ? <Muted>{`Source: ${c.publisher}`}</Muted> : null}
                </View>
              ) : null}
              {saved[c.id] ? (
                <Muted testID={`idea-saved-${c.id}`}>{`Saved "${saved[c.id]}" to your recipes.`}</Muted>
              ) : (
                <Button title="Save to my recipes" disabled={saving === c.id} accessibilityLabel={`Save ${c.title} to my recipes`} onPress={() => void save(c)} testID={`idea-save-${c.id}`} />
              )}
            </View>
          ))}
        </View>
      ))}
    </Section>
  );
}
