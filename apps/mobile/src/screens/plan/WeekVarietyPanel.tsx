import React, { useState } from 'react';
import { View } from 'react-native';
import type { WeekVariety } from '@/lib/plan/ops';
import { Button, Muted, Text } from '../ui';
import { Section } from './parts';

const KINDS = [['fish', 'Fish'], ['meat', 'Meat'], ['plant', 'Plant-based']] as const;
const MORE = 6;

/**
 * "5 a day" and variety for the week (P1-B, D376), the same engine summary as the web planner. An estimate from planned
 * recipes' ingredient weights (80 g portions, one serving per person); descriptive only, no health claims. The Cooked toggle
 * appears only when the server sends cooked meals (cooking log, P1-A).
 */
export default function WeekVarietyPanel({ planned, cooked }: { planned: WeekVariety | null; cooked?: WeekVariety | null }) {
  const [view, setView] = useState<'planned' | 'cooked'>('planned');
  if (!planned && !cooked) return null;
  const data = view === 'cooked' ? cooked ?? null : planned;
  const s = data?.summary;
  const list = (items: string[]) => (items.length <= MORE ? items.join(', ') : `${items.slice(0, MORE).join(', ')} and ${items.length - MORE} more`);
  return (
    <Section title="Fruit, veg and variety" testID="week-variety">
      {cooked !== undefined ? (
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 6 }} accessibilityRole="radiogroup">
          <Button title="Planned" variant={view === 'planned' ? 'primary' : 'secondary'} onPress={() => setView('planned')} testID="variety-planned" />
          <Button title="Cooked" variant={view === 'cooked' ? 'primary' : 'secondary'} onPress={() => setView('cooked')} testID="variety-cooked" />
        </View>
      ) : null}
      {!s ? (
        <Muted testID="week-variety-empty">{view === 'cooked' ? 'Nothing cooked this week yet.' : 'Plan some recipe meals to see this.'}</Muted>
      ) : (
        <>
          <Text testID="variety-score" accessibilityLabel={`Variety score ${s.score} out of 100`}>{`Variety score ${s.score} out of 100`}</Text>
          <Muted>(a rough estimate, not a health score)</Muted>
          <Text style={{ marginTop: 6 }} testID="variety-avg">
            {`About ${s.avgPortionsPerDay} fruit and veg portions per person per ${view === 'cooked' ? 'cooked' : 'planned'} day; ${s.daysWithFive} of ${s.dayCount} ${s.dayCount === 1 ? 'day' : 'days'} reach 5.`}
          </Text>
          {s.mealsWithoutData > 0 ? <Muted>{`${s.mealsWithoutData} ${s.mealsWithoutData === 1 ? 'meal has' : 'meals have'} no ingredient data, so figures are lower bounds.`}</Muted> : null}
          {s.mealsWithoutData === 0 && s.mealsPartlyWeighed > 0 ? <Muted>{`${s.mealsPartlyWeighed} ${s.mealsPartlyWeighed === 1 ? 'meal has' : 'meals have'} ingredients we could not weigh, so figures are lower bounds.`}</Muted> : null}
          {s.days.map((d) => (
            <View key={d.date} accessible accessibilityLabel={`${d.date}: ${d.portions} portions`} style={{ marginTop: 4 }}>
              <Muted>{`${d.date}: ${d.portions} portions${d.portions >= 5 ? ' (5+)' : ''}`}</Muted>
            </View>
          ))}
          <Text style={{ fontWeight: '600', marginTop: 8 }}>Protein variety</Text>
          <View testID="variety-protein">
            {KINDS.map(([k, label]) => <Muted key={k}>{`${label}: ${s.proteinMeals[k]} ${s.proteinMeals[k] === 1 ? 'meal' : 'meals'}`}</Muted>)}
          </View>
          <Muted>{`${s.proteinSources.length} different protein ingredients${s.proteinSources.length ? `: ${list(s.proteinSources)}` : ''}.`}</Muted>
          <Text style={{ fontWeight: '600', marginTop: 8 }}>Plant variety</Text>
          <Muted testID="variety-plants">{`${s.plants.length} different plants${s.plants.length ? `: ${list(s.plants)}` : ''}.`}</Muted>
        </>
      )}
      <Muted testID="week-variety-disclaimer">{`${(s ?? planned?.summary ?? cooked?.summary)?.disclaimer ?? ''} Potatoes, juice, garlic, ginger, chilli and herbs are not counted as portions; pulses count at most once a day.`}</Muted>
    </Section>
  );
}
